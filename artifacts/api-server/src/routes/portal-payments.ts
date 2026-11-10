import { Router, type Request } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, examRegistrations, feePaymentReportsTable, individualFeeChargesTable, paymentAccounts, portalStudents } from "@workspace/db";
import { ManagePaymentAccountsBody, ReportParentTransferBody, ReviewFeeTransferBody, ReviewFeeTransferParams } from "@workspace/api-zod";
import { check, portalActor } from "../lib/portal-auth";
import { accountFor, examFeeStatus, knownSessions, openRegistrationFor, transferView } from "../lib/payment-accounts";
import { usablePaymentProof } from "./school-commerce-proofs";
import { parentEmail } from "./portal-parent";
import { statementFor } from "./portal-fees";
import { recordAudit, clientIp } from "../lib/audit";
import { emailConfigured, sendEmail, transferOutcomeEmail } from "../lib/email";
import { siteOrigin } from "../lib/seo";

/**
 * School fees and WAEC/NECO fees are paid by bank transfer into the school's accounts. A parent sends a screenshot
 * from the parent portal; the school office or the Head of School confirms it, and the parent gets a receipt.
 */
export const portalPaymentsRouter = Router();

/** The school office and the Head of School (both administrators in the portal). */
async function office(req: Request) {
  const actor = await portalActor(req);
  check(actor.role === "admin", actor.role === "guest" ? "Sign in as an administrator." : "Only the school office and the Head of School can manage payments.", actor.role === "guest" ? 401 : 403);
  return req.identity?.email ?? actor.name;
}

const accountView = (a: typeof paymentAccounts.$inferSelect) => ({
  id: a.id, purpose: a.purpose as "school_fees" | "exam_registration", academicYear: a.academicYear, bankName: a.bankName,
  accountName: a.accountName, accountNumber: a.accountNumber, note: a.note, active: a.active,
});
/** Active accounts, for parents choosing where to pay. */
export async function activeAccounts() {
  return (await db.select().from(paymentAccounts).where(eq(paymentAccounts.active, true)).orderBy(paymentAccounts.purpose, desc(paymentAccounts.academicYear))).map(accountView);
}

portalPaymentsRouter.get("/payment-accounts", async (req, res) => {
  await office(req);
  const [accounts, sessions] = await Promise.all([db.select().from(paymentAccounts).orderBy(paymentAccounts.purpose, desc(paymentAccounts.academicYear)), knownSessions()]);
  res.json({ accounts: accounts.map(accountView), sessions });
});

portalPaymentsRouter.post("/payment-accounts", async (req, res) => {
  const by = await office(req);
  const body = ManagePaymentAccountsBody.parse(req.body);
  if (body.action === "delete") {
    check(body.id, "Choose an account.");
    const [gone] = await db.delete(paymentAccounts).where(eq(paymentAccounts.id, body.id)).returning();
    check(gone, "Account not found.", 404);
    await recordAudit({ actorKind: "staff", actorId: req.dbUser?.id ?? null, actorLabel: by, action: "payments.account_removed", targetType: "payment_account", targetId: String(gone.id), before: accountView(gone), ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null });
    res.json({ message: `${gone.bankName} account removed.` });
    return;
  }
  const a = body.account;
  check(a, "Account details required.");
  const values = {
    purpose: a.purpose, academicYear: a.academicYear.trim(), bankName: a.bankName.trim(), accountName: a.accountName.trim(),
    accountNumber: a.accountNumber.replace(/\s+/g, ""), note: a.note.trim(), active: a.active, updatedAt: new Date(),
  };
  check(!values.academicYear || /^\d{4}\/\d{4}$/.test(values.academicYear), "Write the session like 2026/2027, or leave it empty for every session.");
  check(values.bankName.length >= 2, "Enter the bank's name.");
  check(values.accountName.length >= 2, "Enter the account name.");
  check(/^\d{10}$/.test(values.accountNumber), "Nigerian account numbers have 10 digits.");
  if (a.id) {
    const [old] = await db.select().from(paymentAccounts).where(eq(paymentAccounts.id, a.id));
    check(old, "Account not found.", 404);
    await db.update(paymentAccounts).set(values).where(eq(paymentAccounts.id, old.id));
  } else await db.insert(paymentAccounts).values(values);
  res.json({ message: `${values.purpose === "exam_registration" ? "WAEC/NECO" : "School fees"} account saved${values.academicYear ? ` for ${values.academicYear}` : " for every session"}.` });
});

// A parent can report at most 20 transfers an hour.
const recent = new Map<string, number[]>();
function allow(email: string) {
  const now = Date.now();
  const times = (recent.get(email) ?? []).filter((t) => now - t < 3_600_000);
  if (times.length >= 20) return false;
  if (recent.size > 5000) recent.clear();
  recent.set(email, [...times, now]);
  return true;
}

portalPaymentsRouter.post("/parent/transfers", async (req, res) => {
  const email = await parentEmail(req);
  check(email, "Sign in with the email address the school has for you.", 401);
  const body = ReportParentTransferBody.parse(req.body);
  check(allow(email), "Too many payments reported. Please wait a while and try again.", 429);
  const [child] = await db.select().from(portalStudents).where(and(eq(portalStudents.id, body.studentId), eq(portalStudents.active, true),
    sql`(lower(trim(${portalStudents.guardianEmail})) = ${email} or lower(trim(${portalStudents.secondGuardianEmail})) = ${email})`));
  check(child, "This child is not linked to your email.", 404);
  const proof = await usablePaymentProof(body.proofId);
  check(!("error" in proof), "error" in proof ? proof.error : "");
  check("id" in proof && proof.id, "Upload a screenshot of the transfer.");
  const statement = await statementFor(child);
  let values: Partial<typeof feePaymentReportsTable.$inferInsert> & { amountKobo: number; description: string; term: string; academicYear: string; feeType: string; purpose: "school_fees" | "exam_registration" };
  if (body.itemKey.startsWith("exam-")) {
    const year = body.itemKey.slice(5);
    const s = await openRegistrationFor(child.classId);
    check(s && s.academicYear === year && s.feeKobo > 0, "This WAEC/NECO fee is not open for payment.", 404);
    check((await examFeeStatus(child.id, year)) === "due", "This fee is already paid or being checked by the school office.", 409);
    const [form] = await db.select({ id: examRegistrations.id }).from(examRegistrations).where(and(eq(examRegistrations.studentId, child.id), eq(examRegistrations.academicYear, year)));
    values = { feeType: "exam_registration", purpose: "exam_registration", description: s.title, term: "", academicYear: year, amountKobo: s.feeKobo, registrationId: form?.id ?? null };
  } else {
    const item = statement.items.find((i) => i.key === body.itemKey);
    check(item, "This fee was not found on your child's statement.", 404);
    check(item.status === "due" && item.amountKobo > item.paidKobo, item.status === "pending" ? "A payment for this fee is already being checked by the school office." : "This fee is already paid.", 409);
    const id = Number(item.key.split("-")[1]);
    values = {
      feeType: item.kind === "class" ? "class_fee" : "individual_fee", purpose: "school_fees", scheduleId: item.kind === "class" ? id : null, chargeId: item.kind === "class" ? null : id,
      description: item.description, term: item.term, academicYear: item.academicYear, amountKobo: item.amountKobo - item.paidKobo,
    };
  }
  const account = await accountFor(values.purpose, values.academicYear);
  const [row] = await db.insert(feePaymentReportsTable).values({
    ...values, reference: `NWE-FEE-${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`,
    studentName: child.name, studentIdentifier: child.studentId, className: statement.className,
    guardianName: email, guardianEmail: email, guardianPhone: "", parentEmail: email, studentPortalId: child.id,
    transferReference: body.transferReference?.trim() || null, proofImageId: proof.id, status: "reported",
    accountBank: account?.bankName ?? null, accountName: account?.accountName ?? null, accountNumber: account?.accountNumber ?? null,
  }).returning();
  await recordAudit({ actorKind: "parent", actorId: email, actorLabel: email, action: "parent.transfer_reported", targetType: "fee_payment_report", targetId: row.reference, after: { student: child.studentId, amountKobo: row.amountKobo, purpose: row.purpose }, ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null });
  res.json(transferView(row));
});

portalPaymentsRouter.get("/fee-transfers", async (req, res) => {
  await office(req);
  const rows = await db.select().from(feePaymentReportsTable).orderBy(desc(feePaymentReportsTable.createdAt)).limit(500);
  res.json({ transfers: rows.map(transferView), waiting: rows.filter((r) => r.status === "reported" || r.status === "payment_requested").length });
});

portalPaymentsRouter.post("/fee-transfers/:id", async (req, res) => {
  const by = await office(req);
  const { id } = ReviewFeeTransferParams.parse(req.params);
  const body = ReviewFeeTransferBody.parse(req.body);
  const note = body.note?.trim() ?? "";
  if (body.action === "reject") check(note.length >= 3, "Tell the parent why (for example: no money received, or the amount is short).");
  const updated = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(feePaymentReportsTable).where(eq(feePaymentReportsTable.id, id)).for("update");
    check(r, "Payment not found.", 404);
    check(r.status === "reported" || r.status === "payment_requested", r.status === "confirmed" ? "This payment is already confirmed." : "This payment was already marked as not received.", 409);
    const [u] = await tx.update(feePaymentReportsTable).set(body.action === "confirm"
      ? { status: "confirmed", confirmedBy: by, confirmedAt: new Date(), officeNote: note || null }
      : { status: "rejected", officeNote: note }).where(eq(feePaymentReportsTable.id, r.id)).returning();
    if (u.chargeId !== null) await tx.update(individualFeeChargesTable).set({ status: body.action === "confirm" ? "paid" : "due" }).where(eq(individualFeeChargesTable.id, u.chargeId));
    return u;
  });
  const view = transferView(updated);
  await recordAudit({ actorKind: "staff", actorId: req.dbUser?.id ?? null, actorLabel: by, action: body.action === "confirm" ? "payments.transfer_confirmed" : "payments.transfer_rejected", targetType: "fee_payment_report", targetId: updated.reference, after: { amountKobo: updated.amountKobo, receipt: view.receiptNumber, note }, ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null });
  const to = updated.parentEmail || updated.guardianEmail;
  if (emailConfigured() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    const mail = transferOutcomeEmail({ confirmed: body.action === "confirm", receiptNumber: view.receiptNumber, studentName: updated.studentName, description: view.description, academicYear: updated.academicYear, amountKobo: updated.amountKobo, note, portalUrl: `${siteOrigin()}/parents` });
    sendEmail({ to, ...mail }).then((r) => { if (!r.sent) req.log.warn({ reason: r.reason }, "Transfer outcome not emailed"); }, () => undefined);
  }
  res.json(view);
});
