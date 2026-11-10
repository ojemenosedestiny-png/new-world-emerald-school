import { Router, type Request } from "express";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db, feePaymentReportsTable, parentPayments, portalImages, schoolTransactions, storeOrdersTable, type SchoolTransactionRecord } from "@workspace/db";
import { DecideSchoolTransactionBody, DecideSchoolTransactionParams, GetAccountsReceiptParams, GetSchoolAccountsQueryParams, RecordSchoolTransactionBody } from "@workspace/api-zod";
import { check } from "../lib/portal-auth";
import { canUseAccounts, isSuperAdmin } from "../lib/website-admin";
import { superAdminEmails } from "../lib/approved-identities";
import { receiptNumber } from "../lib/payment-accounts";
import { usablePaymentProof } from "./school-commerce-proofs";
import { recordAudit, clientIp } from "../lib/audit";
import { emailConfigured, sendEmail, spendingEmail } from "../lib/email";
import { siteOrigin } from "../lib/seo";
import { serveImage } from "../lib/images";

/**
 * The school accounts: every naira in and out, on one page for the bursar and the school owner.
 * - Money in is read from where it happens: fee transfers the office confirmed, card payments, and paid store
 *   orders. The bursar adds other income (donations, uniforms, bus, cash) by hand, with a receipt photo.
 * - Money out is recorded by the bursar and counts only after the school owner (super administrator) approves it.
 * - Only the owner approves, rejects or cancels (voids) entries, always with a reason when saying no.
 */
export const schoolAccountsRouter = Router();

export const INCOME_CATEGORIES = ["Donation", "Uniforms and books", "School bus", "PTA levy", "Cash fees", "Lessons and extra classes", "Other income"];
export const EXPENSE_CATEGORIES = [
  "Salaries and wages", "Electricity and diesel", "Repairs and maintenance", "Teaching materials", "Food and kitchen",
  "Transport and fuel", "WAEC/NECO remittance", "Taxes and levies", "Bank charges", "Office supplies", "Other spending",
];
// About ten billion naira: far above any real entry, well inside a safe integer.
const MAX_KOBO = 1_000_000_000_000;

type Entry = {
  key: string; source: "manual" | "fee_transfer" | "card" | "store"; id: number | null; direction: "in" | "out"; category: string;
  description: string; counterparty: string; amountKobo: number; date: string; method: string; reference: string; receiptId: string | null;
  status: "pending" | "approved" | "rejected" | "void"; recordedBy: string; decidedBy: string | null; decidedAt: string | null; note: string;
};

/** The calendar day in Lagos (UTC+1, no daylight saving). */
const lagosDate = (d: Date) => new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10);
const dayStart = (day: string) => new Date(`${day}T00:00:00+01:00`);
const dayEnd = (day: string) => new Date(`${day}T23:59:59.999+01:00`);
const validDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(dayStart(v).getTime()) && lagosDate(dayStart(v)) === v;
const n = (v: unknown) => Number(v ?? 0);

async function keeper(req: Request) {
  check(canUseAccounts(req), req.identity ? "The school accounts are for the bursar and the school owner only." : "Sign in to open the school accounts.", req.identity ? 403 : 401);
  return { email: req.identity!.email!.trim().toLowerCase(), owner: isSuperAdmin(req) };
}

export function manualEntry(t: SchoolTransactionRecord): Entry {
  return {
    key: `txn-${t.id}`, source: "manual", id: t.id, direction: t.direction as "in" | "out", category: t.category, description: t.description,
    counterparty: t.counterparty, amountKobo: t.amountKobo, date: t.occurredOn, method: t.method, reference: t.reference, receiptId: t.receiptImageId,
    status: t.status as Entry["status"], recordedBy: t.recordedBy, decidedBy: t.decidedBy, decidedAt: t.decidedAt?.toISOString() ?? null, note: t.decisionNote,
  };
}

/** Money that came in through the portal between two instants: confirmed fee transfers, card payments, paid store orders. */
async function automaticIncome(from: Date, to: Date): Promise<Entry[]> {
  const feeDay = sql`coalesce(${feePaymentReportsTable.confirmedAt}, ${feePaymentReportsTable.updatedAt})`;
  const cardDay = sql`coalesce(${parentPayments.paidAt}, ${parentPayments.settledAt}, ${parentPayments.createdAt})`;
  const [fees, cards, orders] = await Promise.all([
    db.select().from(feePaymentReportsTable).where(and(eq(feePaymentReportsTable.status, "confirmed"), gte(feeDay, from), lte(feeDay, to))),
    db.select().from(parentPayments).where(and(eq(parentPayments.status, "success"), gte(cardDay, from), lte(cardDay, to))),
    db.select().from(storeOrdersTable).where(and(eq(storeOrdersTable.paymentStatus, "confirmed"), gte(storeOrdersTable.updatedAt, from), lte(storeOrdersTable.updatedAt, to))),
  ]);
  return [
    ...fees.map((r): Entry => {
      const at = r.confirmedAt ?? r.updatedAt;
      return {
        key: `fee-${r.id}`, source: "fee_transfer", id: null, direction: "in", category: r.purpose === "exam_registration" ? "WAEC/NECO fees" : "School fees",
        description: `${r.description || r.feeType}${r.term ? ` · ${r.term}` : ""}${r.academicYear ? ` ${r.academicYear}` : ""} · ${r.studentName}${r.className ? ` (${r.className})` : ""}`,
        counterparty: r.guardianName || r.parentEmail || "", amountKobo: r.amountKobo, date: lagosDate(at), method: "transfer",
        reference: receiptNumber(r.id, at), receiptId: r.proofImageId, status: "approved", recordedBy: "Parent payment", decidedBy: r.confirmedBy, decidedAt: at.toISOString(), note: r.transferReference ?? "",
      };
    }),
    ...cards.filter((p) => p.cardKobo > 0).map((p): Entry => {
      const at = p.paidAt ?? p.settledAt ?? p.createdAt;
      const kids = [...new Set(p.allocations.map((a) => a.studentName))].join(", ");
      return {
        key: `card-${p.id}`, source: "card", id: null, direction: "in", category: "School fees (card)", description: `Card payment${kids ? ` · ${kids}` : ""}`,
        counterparty: p.parentEmail, amountKobo: p.cardKobo, date: lagosDate(at), method: "card", reference: p.reference, receiptId: null,
        status: "approved", recordedBy: "Paystack", decidedBy: null, decidedAt: at.toISOString(), note: "",
      };
    }),
    ...orders.map((o): Entry => ({
      key: `store-${o.id}`, source: "store", id: null, direction: "in", category: "School store",
      description: `${o.items.map((i) => `${i.title} × ${i.quantity}`).join(", ")} · ${o.studentName}`, counterparty: o.guardianName, amountKobo: o.totalKobo,
      date: lagosDate(o.updatedAt), method: "transfer", reference: o.reference, receiptId: o.proofImageId, status: "approved", recordedBy: "School store",
      decidedBy: null, decidedAt: o.updatedAt.toISOString(), note: o.transferReference ?? "",
    })),
  ];
}

/** Everything ever received or approved for spending, for the running balance. */
async function balanceKobo() {
  const [[fee], [card], [store], manual] = await Promise.all([
    db.select({ k: sql`coalesce(sum(${feePaymentReportsTable.amountKobo}), 0)` }).from(feePaymentReportsTable).where(eq(feePaymentReportsTable.status, "confirmed")),
    db.select({ k: sql`coalesce(sum(${parentPayments.cardKobo}), 0)` }).from(parentPayments).where(eq(parentPayments.status, "success")),
    db.select({ k: sql`coalesce(sum(${storeOrdersTable.totalKobo}), 0)` }).from(storeOrdersTable).where(eq(storeOrdersTable.paymentStatus, "confirmed")),
    db.select({ direction: schoolTransactions.direction, k: sql`coalesce(sum(${schoolTransactions.amountKobo}), 0)` }).from(schoolTransactions)
      .where(eq(schoolTransactions.status, "approved")).groupBy(schoolTransactions.direction),
  ]);
  const manualIn = n(manual.find((m) => m.direction === "in")?.k);
  const manualOut = n(manual.find((m) => m.direction === "out")?.k);
  return n(fee?.k) + n(card?.k) + n(store?.k) + manualIn - manualOut;
}

/** The months from one day to another, as YYYY-MM. */
function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const end = to.slice(0, 7);
  for (let i = 0; i < 120; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= end) break;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

schoolAccountsRouter.get("/accounts", async (req, res) => {
  const me = await keeper(req);
  res.setHeader("Cache-Control", "no-store");
  const q = GetSchoolAccountsQueryParams.parse(req.query);
  const today = lagosDate(new Date());
  const to = q.to && validDay(q.to) ? q.to : today;
  const from = q.from && validDay(q.from) && q.from <= to ? q.from : `${to.slice(0, 7)}-01`;
  const [auto, manual, pendingRows, balance] = await Promise.all([
    automaticIncome(dayStart(from), dayEnd(to)),
    db.select().from(schoolTransactions).where(and(gte(schoolTransactions.occurredOn, from), lte(schoolTransactions.occurredOn, to))).orderBy(desc(schoolTransactions.occurredOn), desc(schoolTransactions.id)),
    db.select().from(schoolTransactions).where(eq(schoolTransactions.status, "pending")).orderBy(desc(schoolTransactions.createdAt)),
    balanceKobo(),
  ]);
  const entries = [...manual.map(manualEntry), ...auto].sort((a, b) => (b.date.localeCompare(a.date)) || b.key.localeCompare(a.key));
  const counted = entries.filter((e) => e.status === "approved");
  const sum = (list: Entry[]) => list.reduce((s, e) => s + e.amountKobo, 0);
  const inKobo = sum(counted.filter((e) => e.direction === "in"));
  const outKobo = sum(counted.filter((e) => e.direction === "out"));
  const months = monthsBetween(from, to).map((month) => {
    const rows = counted.filter((e) => e.date.startsWith(month));
    return { month, inKobo: sum(rows.filter((e) => e.direction === "in")), outKobo: sum(rows.filter((e) => e.direction === "out")) };
  });
  const groups = new Map<string, { direction: "in" | "out"; category: string; amountKobo: number; count: number }>();
  for (const e of counted) {
    const k = `${e.direction}:${e.category}`;
    const g = groups.get(k) ?? { direction: e.direction, category: e.category, amountKobo: 0, count: 0 };
    g.amountKobo += e.amountKobo; g.count += 1; groups.set(k, g);
  }
  const pending = pendingRows.map(manualEntry);
  res.json({
    role: me.owner ? "owner" : "bursar", canApprove: me.owner, from, to, generatedAt: new Date().toISOString(),
    totals: { inKobo, outKobo, netKobo: inKobo - outKobo, pendingKobo: sum(pending), pendingCount: pending.length, balanceKobo: balance },
    months, categories: [...groups.values()].sort((a, b) => b.amountKobo - a.amountKobo),
    entries: entries.slice(0, 3000), pending, incomeCategories: INCOME_CATEGORIES, expenseCategories: EXPENSE_CATEGORIES,
  });
});

schoolAccountsRouter.post("/accounts/transactions", async (req, res) => {
  const me = await keeper(req);
  const body = RecordSchoolTransactionBody.parse(req.body);
  const out = body.direction === "out";
  check((out ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).includes(body.category), "Choose a category from the list.");
  const description = body.description.trim();
  check(description.length >= 3 && description.length <= 200, "Describe what the money was for (3 to 200 characters).");
  const counterparty = (body.counterparty ?? "").trim();
  check(counterparty.length <= 120, "The name of who paid or was paid is too long.");
  check(!out || counterparty.length >= 2, "Enter who the school paid (a person, shop or company).");
  check(Number.isInteger(body.amountKobo) && body.amountKobo > 0 && body.amountKobo <= MAX_KOBO, "Enter an amount above zero.");
  check(validDay(body.date), "Enter the date the money moved.");
  check(body.date <= lagosDate(new Date()) && body.date >= "2000-01-01", "The date cannot be in the future.");
  const reference = (body.reference ?? "").trim();
  check(reference.length <= 100, "The reference is too long.");
  const proof = await usablePaymentProof(body.receiptId);
  if ("error" in proof) check(false, proof.error.replace("payment screenshot", "receipt photo").replace("screenshot", "receipt photo"));
  const receiptId = "id" in proof ? proof.id : null;
  // Income counts at once; spending waits for the owner, unless the owner records it.
  const approvedNow = !out || me.owner;
  const [row] = await db.insert(schoolTransactions).values({
    direction: body.direction, category: body.category, description, counterparty, amountKobo: body.amountKobo, occurredOn: body.date,
    method: body.method, reference, receiptImageId: receiptId, status: approvedNow ? "approved" : "pending", recordedBy: me.email,
    ...(out && me.owner ? { decidedBy: me.email, decidedAt: new Date() } : {}),
  }).returning();
  await recordAudit({ actorKind: "staff", actorId: req.dbUser?.id ?? null, actorLabel: me.email, action: out ? "accounts.spending_recorded" : "accounts.income_recorded", targetType: "school_transaction", targetId: String(row.id), after: { amountKobo: row.amountKobo, category: row.category, status: row.status }, ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null });
  if (row.status === "pending" && emailConfigured()) {
    const mail = spendingEmail({ kind: "waiting", description, category: row.category, counterparty, amountKobo: row.amountKobo, date: row.occurredOn, recordedBy: me.email, note: "", url: `${siteOrigin()}/accounts` });
    for (const to of superAdminEmails()) sendEmail({ to, ...mail }).then((r) => { if (!r.sent) req.log.warn({ reason: r.reason }, "Spending approval request not emailed"); }, () => undefined);
  }
  res.json(manualEntry(row));
});

schoolAccountsRouter.post("/accounts/transactions/:id", async (req, res) => {
  const me = await keeper(req);
  const { id } = DecideSchoolTransactionParams.parse(req.params);
  const body = DecideSchoolTransactionBody.parse(req.body);
  const note = (body.note ?? "").trim().slice(0, 500);
  if (body.action !== "cancel") check(me.owner, "Only the school owner can approve, reject or cancel entries.", 403);
  if (body.action === "reject" || body.action === "void") check(note.length >= 3, "Write the reason, so the bursar knows why.");
  const updated = await db.transaction(async (tx) => {
    const [t] = await tx.select().from(schoolTransactions).where(eq(schoolTransactions.id, id)).for("update");
    check(t, "Entry not found.", 404);
    if (body.action === "approve" || body.action === "reject") {
      check(t.direction === "out", "Only spending needs approval.", 409);
      check(t.status === "pending", t.status === "approved" ? "This spending is already approved." : "This entry was already decided.", 409);
    } else if (body.action === "void") {
      check(t.status === "approved", "Only an entry that counts in the accounts can be cancelled.", 409);
    } else {
      check(t.recordedBy === me.email, "You can only withdraw entries you recorded.", 403);
      check(t.status === "pending", "Only spending still waiting for approval can be withdrawn.", 409);
    }
    const status = body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : "void";
    const decisionNote = body.action === "cancel" ? (note || "Withdrawn by the person who recorded it.") : note;
    const [u] = await tx.update(schoolTransactions).set({ status, decidedBy: me.email, decidedAt: new Date(), decisionNote }).where(eq(schoolTransactions.id, t.id)).returning();
    return u;
  });
  await recordAudit({ actorKind: "staff", actorId: req.dbUser?.id ?? null, actorLabel: me.email, action: `accounts.${body.action}`, targetType: "school_transaction", targetId: String(updated.id), after: { amountKobo: updated.amountKobo, status: updated.status, note: updated.decisionNote }, ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null });
  if (body.action !== "cancel" && updated.recordedBy !== me.email && emailConfigured() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updated.recordedBy)) {
    const kind = body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : "voided";
    const mail = spendingEmail({ kind, description: updated.description, category: updated.category, counterparty: updated.counterparty, amountKobo: updated.amountKobo, date: updated.occurredOn, recordedBy: updated.recordedBy, note: updated.decisionNote, url: `${siteOrigin()}/accounts` });
    sendEmail({ to: updated.recordedBy, ...mail }).then((r) => { if (!r.sent) req.log.warn({ reason: r.reason }, "Spending decision not emailed"); }, () => undefined);
  }
  res.json(manualEntry(updated));
});

/** A receipt or payment screenshot, only when it belongs to something in the accounts. */
schoolAccountsRouter.get("/accounts/receipts/:id", async (req, res) => {
  await keeper(req);
  const { id } = GetAccountsReceiptParams.parse(req.params);
  check(/^[0-9a-f-]{36}$/.test(id), "Receipt not found.", 404);
  const [[entry], [fee], [order]] = await Promise.all([
    db.select({ id: schoolTransactions.id }).from(schoolTransactions).where(eq(schoolTransactions.receiptImageId, id)),
    db.select({ id: feePaymentReportsTable.id }).from(feePaymentReportsTable).where(and(eq(feePaymentReportsTable.proofImageId, id), eq(feePaymentReportsTable.status, "confirmed"))),
    db.select({ id: storeOrdersTable.id }).from(storeOrdersTable).where(and(eq(storeOrdersTable.proofImageId, id), eq(storeOrdersTable.paymentStatus, "confirmed"))),
  ]);
  check(entry || fee || order, "Receipt not found.", 404);
  const [row] = await db.select().from(portalImages).where(and(eq(portalImages.id, id), eq(portalImages.purpose, "payment")));
  check(row, "Receipt not found.", 404);
  res.setHeader("Cache-Control", "private, no-store");
  await serveImage(req, res, row);
});
