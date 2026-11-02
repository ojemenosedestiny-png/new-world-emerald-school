import { Router, type Request } from "express";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, parentPayments, parentWalletEntries, parentWallets, portalClasses, portalStudents, type ParentPaymentRecord, type ParentPaymentSelection } from "@workspace/db";
import { StartParentPaymentBody, AdjustParentWalletBody } from "@workspace/api-zod";
import { check, portalActor, verifiedClerkEmail } from "../lib/portal-auth";
import { statementFor, type DbExec } from "./portal-fees";
import { amountProblem, chosen, newPaymentReference, selectionProblem, settle, type OutstandingItem } from "../lib/parent-payments";
import { initializePayment, paystackConfigured, PaystackError, verifyPayment, type VerifiedTransaction } from "../lib/paystack";
import { siteOrigin } from "../lib/seo";
import { emailConfigured, feeReceiptEmail, sendEmail } from "../lib/email";
import { recordAudit, clientIp } from "../lib/audit";

export const portalParentRouter = Router();
type Log = { warn: (o: object, m: string) => void; error: (o: object, m: string) => void };

// Parents are recognised by the email the school recorded for their child (guardian email), once they have
// confirmed it by signing in with an emailed code. Tests replace the lookup.
let parentEmailOf: (req: Request) => Promise<string | null> = verifiedClerkEmail;
export function setParentEmailResolverForTest(fn: typeof parentEmailOf) { parentEmailOf = fn; }

async function signedInParent(req: Request) {
  const email = await parentEmailOf(req);
  check(email, "Sign in with the email address the school has for you.", 401);
  return email;
}

const childrenOf = (exec: DbExec, email: string) => exec.select().from(portalStudents)
  .where(and(sql`lower(trim(${portalStudents.guardianEmail})) = ${email}`, eq(portalStudents.active, true)))
  .orderBy(portalStudents.name);

/** Each child with their fee statement, and every item that still has money owed (bank transfers being checked are left out). */
async function familyStatements(exec: DbExec, email: string) {
  const kids = await childrenOf(exec, email);
  const children = await Promise.all(kids.map(async (k) => ({ id: k.id, name: k.name, studentId: k.studentId, photoImageId: k.photoImageId ?? null, statement: await statementFor(k, exec) })));
  const outstanding: OutstandingItem[] = children.flatMap((c) => c.statement.items
    .filter((i) => i.status === "due" && i.amountKobo > i.paidKobo)
    .map((i) => ({ studentId: c.id, studentCode: c.studentId, studentName: c.name, className: c.statement.className, itemKey: i.key,
      description: i.description, term: i.term, academicYear: i.academicYear, outstandingKobo: i.amountKobo - i.paidKobo })));
  return { children, outstanding };
}

async function walletBalance(exec: DbExec, email: string) {
  const [w] = await exec.select({ balanceKobo: parentWallets.balanceKobo }).from(parentWallets).where(eq(parentWallets.email, email));
  return w?.balanceKobo ?? 0;
}

const view = (p: ParentPaymentRecord) => ({
  reference: p.reference, status: p.status, parentEmail: p.parentEmail, cardKobo: p.cardKobo,
  walletUsedKobo: p.walletUsedKobo, walletCreditKobo: p.walletCreditKobo,
  appliedKobo: p.allocations.reduce((n, a) => n + a.amountKobo, 0), allocations: p.allocations,
  channel: p.channel, gatewayResponse: p.gatewayResponse,
  createdAt: p.createdAt.toISOString(), paidAt: p.paidAt?.toISOString() ?? null, settledAt: p.settledAt?.toISOString() ?? null,
});

/**
 * Applies a payment once: locks it and the parent's wallet, re-reads what is owed now, spends the wallet first,
 * pays the chosen items oldest first, and puts anything left over back into the wallet. Card payments are applied
 * only when Paystack itself confirms success for exactly the amount and currency started here.
 */
export async function settlePayment(reference: string, verified: VerifiedTransaction | null, log: Log) {
  const result = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(parentPayments).where(eq(parentPayments.reference, reference)).for("update");
    if (!p || p.status !== "pending") return { payment: p ?? null, balanceAfterKobo: null };
    if (p.cardKobo > 0) {
      if (!verified) return { payment: p, balanceAfterKobo: null };
      if (verified.status !== "success") {
        // "abandoned" or "ongoing" can still complete; only a definite failure closes the payment.
        if (verified.status === "failed" || verified.status === "reversed") {
          const [failed] = await tx.update(parentPayments).set({ status: "failed", gatewayResponse: verified.gatewayResponse, settledAt: new Date() }).where(eq(parentPayments.id, p.id)).returning();
          return { payment: failed, balanceAfterKobo: null };
        }
        return { payment: p, balanceAfterKobo: null };
      }
      if (verified.reference !== p.reference || verified.amountKobo !== p.cardKobo || verified.currency !== "NGN") {
        log.error({ reference, expected: p.cardKobo, got: verified.amountKobo, currency: verified.currency }, "Paystack amount or currency does not match the payment started");
        const [held] = await tx.update(parentPayments).set({ status: "failed", gatewayResponse: "Amount did not match: held for the school office to check", settledAt: new Date() }).where(eq(parentPayments.id, p.id)).returning();
        return { payment: held, balanceAfterKobo: null };
      }
    }
    await tx.insert(parentWallets).values({ email: p.parentEmail }).onConflictDoNothing();
    const [wallet] = await tx.select().from(parentWallets).where(eq(parentWallets.email, p.parentEmail)).for("update");
    const { outstanding } = await familyStatements(tx, p.parentEmail);
    const s = settle(p.cardKobo, wallet.balanceKobo, chosen(p.selection, outstanding));
    if (p.cardKobo === 0 && s.allocatedKobo === 0) {
      const [nothing] = await tx.update(parentPayments).set({ status: "failed", gatewayResponse: "Nothing was left to pay", settledAt: new Date() }).where(eq(parentPayments.id, p.id)).returning();
      return { payment: nothing, balanceAfterKobo: null };
    }
    const now = new Date();
    if (s.walletUsedKobo || s.walletCreditKobo) {
      await tx.update(parentWallets).set({ balanceKobo: s.balanceAfterKobo, updatedAt: now }).where(eq(parentWallets.email, p.parentEmail));
      let running = wallet.balanceKobo;
      if (s.walletUsedKobo) {
        running -= s.walletUsedKobo;
        await tx.insert(parentWalletEntries).values({ email: p.parentEmail, amountKobo: -s.walletUsedKobo, balanceAfterKobo: running, kind: "used", paymentReference: p.reference, note: "Used towards school fees" });
      }
      if (s.walletCreditKobo) {
        running += s.walletCreditKobo;
        await tx.insert(parentWalletEntries).values({ email: p.parentEmail, amountKobo: s.walletCreditKobo, balanceAfterKobo: running, kind: "overpayment", paymentReference: p.reference, note: "Paid more than was owed" });
      }
    }
    const [done] = await tx.update(parentPayments).set({
      status: "success", allocations: s.allocations, walletUsedKobo: s.walletUsedKobo, walletCreditKobo: s.walletCreditKobo,
      channel: p.cardKobo > 0 ? verified!.channel : "wallet", gatewayResponse: p.cardKobo > 0 ? verified!.gatewayResponse : null,
      paidAt: p.cardKobo > 0 && verified!.paidAt ? new Date(verified!.paidAt) : now, settledAt: now,
    }).where(eq(parentPayments.id, p.id)).returning();
    return { payment: done, balanceAfterKobo: s.balanceAfterKobo };
  });
  // The receipt email is sent once, after the money is safely recorded; a failure never undoes the payment.
  if (result.payment?.status === "success" && result.balanceAfterKobo !== null && emailConfigured()) {
    const p = result.payment;
    const mail = feeReceiptEmail({ reference: p.reference, paidAt: p.paidAt ?? new Date(), cardKobo: p.cardKobo, walletUsedKobo: p.walletUsedKobo,
      walletCreditKobo: p.walletCreditKobo, balanceAfterKobo: result.balanceAfterKobo, lines: p.allocations, portalUrl: `${siteOrigin()}/parents` });
    sendEmail({ to: p.parentEmail, ...mail }).then((r) => { if (!r.sent) log.warn({ reason: r.reason }, "Fee receipt not emailed"); }, () => undefined);
  }
  return result.payment;
}

/** Asks Paystack about a pending card payment and applies it if it succeeded. */
export async function checkWithPaystack(reference: string, log: Log) {
  let verified: VerifiedTransaction | null = null;
  try { verified = await verifyPayment(reference); } catch (error) { log.warn({ err: error, reference }, "Paystack verification failed"); }
  return settlePayment(reference, verified, log);
}

portalParentRouter.get("/parent", async (req, res) => {
  const email = await signedInParent(req);
  const { children, outstanding } = await familyStatements(db, email);
  const [balanceKobo, entries, payments] = await Promise.all([
    walletBalance(db, email),
    db.select().from(parentWalletEntries).where(eq(parentWalletEntries.email, email)).orderBy(desc(parentWalletEntries.createdAt)).limit(30),
    db.select().from(parentPayments).where(eq(parentPayments.parentEmail, email)).orderBy(desc(parentPayments.createdAt)).limit(30),
  ]);
  const classIds = [...new Set((await childrenOf(db, email)).map((k) => k.classId))];
  const classes = classIds.length ? await db.select({ id: portalClasses.id, name: portalClasses.name }).from(portalClasses).where(inArray(portalClasses.id, classIds)) : [];
  res.json({
    email, paystackReady: paystackConfigured(), classCount: classes.length,
    wallet: { balanceKobo, entries: entries.map((e) => ({ amountKobo: e.amountKobo, balanceAfterKobo: e.balanceAfterKobo, kind: e.kind, paymentReference: e.paymentReference, note: e.note, createdAt: e.createdAt.toISOString() })) },
    children, outstanding, payments: payments.map(view),
  });
});

// A parent can start at most 20 payments an hour: enough for real use, and it stops anyone flooding Paystack.
const starts = new Map<string, number[]>();
function allowStart(email: string) {
  const now = Date.now();
  const recent = (starts.get(email) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= 20) return false;
  if (starts.size > 5000) starts.clear();
  starts.set(email, [...recent, now]);
  return true;
}

portalParentRouter.post("/parent/payments", async (req, res) => {
  const email = await signedInParent(req);
  const body = StartParentPaymentBody.parse(req.body);
  check(allowStart(email), "Too many payment attempts. Please wait a while and try again.", 429);
  const selection: ParentPaymentSelection[] = body.items.map((i) => ({ studentId: i.studentId, itemKey: i.itemKey }));
  const { children, outstanding } = await familyStatements(db, email);
  check(children.length, "No children are registered with your email address. Ask the school office to add it.", 403);
  const problem = selectionProblem(selection, outstanding);
  check(!problem, problem ?? "");
  const owed = chosen(selection, outstanding).reduce((n, i) => n + i.outstandingKobo, 0);
  const wallet = await walletBalance(db, email);
  const amountIssue = amountProblem(body.amountKobo, owed, wallet);
  check(!amountIssue, amountIssue ?? "");
  const reference = newPaymentReference();
  await db.insert(parentPayments).values({ reference, parentEmail: email, cardKobo: body.amountKobo, selection });
  await recordAudit({ actorKind: "parent", actorId: email, actorLabel: email, action: "parent.payment_started", targetType: "parent_payment", targetId: reference, after: { amountKobo: body.amountKobo, items: selection.length }, ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null });
  if (body.amountKobo === 0) {
    // Paid entirely from the wallet: nothing goes to Paystack.
    const payment = await settlePayment(reference, null, req.log);
    res.json({ reference, authorizationUrl: null, payment: payment ? view(payment) : null });
    return;
  }
  check(paystackConfigured(), "Online payment is not set up yet. Please pay by bank transfer or contact the school office.", 503);
  try {
    const authorizationUrl = await initializePayment({
      email, amountKobo: body.amountKobo, reference, callbackUrl: `${siteOrigin()}/parents?reference=${encodeURIComponent(reference)}`,
      metadata: { purpose: "school_fees", children: [...new Set(chosen(selection, outstanding).map((i) => `${i.studentName} (${i.studentCode})`))].join(", ") },
    });
    res.json({ reference, authorizationUrl, payment: null });
  } catch (error) {
    await db.update(parentPayments).set({ status: "failed", gatewayResponse: "Could not start with Paystack", settledAt: new Date() }).where(eq(parentPayments.reference, reference));
    req.log.warn({ err: error }, "Paystack initialisation failed");
    check(false, error instanceof PaystackError ? `Paystack could not start the payment: ${error.message}` : "Paystack could not be reached. Please try again.", 502);
  }
});

portalParentRouter.post("/parent/payments/:reference/verify", async (req, res) => {
  const email = await signedInParent(req);
  const reference = String(req.params.reference);
  const [p] = await db.select().from(parentPayments).where(and(eq(parentPayments.reference, reference), eq(parentPayments.parentEmail, email)));
  check(p, "Payment not found.", 404);
  const payment = p.status === "pending" && p.cardKobo > 0 ? await checkWithPaystack(reference, req.log) : p;
  res.json(view(payment ?? p));
});

async function officeOnly(req: Request) {
  const actor = await portalActor(req);
  check(actor.role === "admin", actor.role === "guest" ? "Sign in as an administrator." : "Only the school office can see payments.", actor.role === "guest" ? 401 : 403);
}

portalParentRouter.get("/parent-payments", async (req, res) => {
  await officeOnly(req);
  // Card payments left pending (the parent closed Paystack's page) are checked again when the office looks.
  const stale = await db.select({ reference: parentPayments.reference }).from(parentPayments)
    .where(and(eq(parentPayments.status, "pending"), gt(parentPayments.cardKobo, 0), sql`${parentPayments.createdAt} > now() - interval '3 days'`)).limit(10);
  if (paystackConfigured()) for (const s of stale) await checkWithPaystack(s.reference, req.log);
  const [payments, wallets, [noEmail]] = await Promise.all([
    db.select().from(parentPayments).orderBy(desc(parentPayments.createdAt)).limit(300),
    db.select().from(parentWallets).where(gt(parentWallets.balanceKobo, 0)).orderBy(desc(parentWallets.balanceKobo)),
    db.select({ n: sql<number>`count(*)::int` }).from(portalStudents).where(and(eq(portalStudents.active, true), sql`coalesce(trim(${portalStudents.guardianEmail}), '') = ''`)),
  ]);
  res.json({
    paystackReady: paystackConfigured(), studentsWithoutParentEmail: noEmail?.n ?? 0,
    payments: payments.map(view),
    wallets: wallets.map((w) => ({ email: w.email, balanceKobo: w.balanceKobo, updatedAt: w.updatedAt.toISOString() })),
  });
});

portalParentRouter.post("/parent-wallets/adjust", async (req, res) => {
  await officeOnly(req);
  const body = AdjustParentWalletBody.parse(req.body);
  const email = body.email.trim().toLowerCase();
  const note = body.note.trim();
  check(note.length >= 3, "Say why the balance is changing (for example: refunded in cash).");
  check(Number.isSafeInteger(body.amountKobo) && body.amountKobo !== 0 && Math.abs(body.amountKobo) <= 2_000_000_000, "Enter a valid amount.");
  const balanceAfterKobo = await db.transaction(async (tx) => {
    await tx.insert(parentWallets).values({ email }).onConflictDoNothing();
    const [w] = await tx.select().from(parentWallets).where(eq(parentWallets.email, email)).for("update");
    const next = w.balanceKobo + body.amountKobo;
    check(next >= 0, "A wallet cannot go below zero.");
    await tx.update(parentWallets).set({ balanceKobo: next, updatedAt: new Date() }).where(eq(parentWallets.email, email));
    await tx.insert(parentWalletEntries).values({ email, amountKobo: body.amountKobo, balanceAfterKobo: next, kind: "adjustment", note, createdBy: req.dbUser?.id ?? null });
    return next;
  });
  await recordAudit({ actorKind: "staff", actorId: req.dbUser?.id ?? "office", actorLabel: req.identity?.email ?? "office", action: "parent.wallet_adjusted", targetType: "parent_wallet", targetId: email, after: { amountKobo: body.amountKobo, note }, ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null });
  res.json({ message: `Wallet updated. New balance: ₦${(balanceAfterKobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}.` });
});
