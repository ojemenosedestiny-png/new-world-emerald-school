/** Case- and space-insensitive key, matching how the fee forms compare student IDs and class names. */
export const feeKey = (value: string) => value.trim().toLocaleUpperCase().replace(/\s+/g, "");

export type FeeItemStatus = "due" | "pending" | "paid";
type Schedule = { id: number; className: string; term: string; academicYear: string; amountKobo: number; description: string; isActive: boolean };
type Charge = { id: number; reference: string; term: string; academicYear: string; description: string; amountKobo: number; status: string };
type Report = { reference: string; feeType: string; scheduleId: number | null; chargeId: number | null; description: string; amountKobo: number; status: string; createdAt: Date };
/** Online (Paystack and wallet) money applied to one statement item. */
export type OnlineCredit = { itemKey: string; amountKobo: number };
/** A successful online payment, listed with the statement's payments. */
export type OnlinePayment = { reference: string; amountKobo: number; createdAt: Date };

const AWAITING = new Set(["payment_requested", "reported"]);
type ItemBase = { key: string; kind: "class" | "individual"; description: string; term: string; academicYear: string; amountKobo: number; reference: string | null };

/**
 * One student's fee statement: active class fees for their class plus individual charges, each marked paid,
 * pending (a payment report awaits review) or due. A confirmed bank-transfer report or a charge marked paid
 * settles the whole item; online payments can settle part of it (paidKobo). Cancelled charges are left out.
 */
export function feeStatement(className: string, schedules: Schedule[], charges: Charge[], reports: Report[], online: OnlineCredit[] = [], onlinePayments: OnlinePayment[] = []) {
  const cls = feeKey(className);
  const onlineFor = (key: string) => online.filter((o) => o.itemKey === key).reduce((n, o) => n + o.amountKobo, 0);
  const item = (base: ItemBase, confirmed: boolean, match: (r: Report) => boolean) => {
    const settled = confirmed || reports.some((r) => match(r) && r.status === "confirmed");
    const paidKobo = settled ? base.amountKobo : Math.min(base.amountKobo, onlineFor(base.key));
    const status: FeeItemStatus = paidKobo >= base.amountKobo ? "paid" : reports.some((r) => match(r) && AWAITING.has(r.status)) ? "pending" : "due";
    return { ...base, paidKobo, status };
  };
  const items = [
    ...schedules.filter((s) => s.isActive && feeKey(s.className) === cls).map((s) => item({
      key: `class-${s.id}`, kind: "class", description: s.description || "School fees", term: s.term, academicYear: s.academicYear,
      amountKobo: s.amountKobo, reference: null,
    }, false, (r) => r.scheduleId === s.id)),
    ...charges.filter((c) => c.status !== "cancelled").map((c) => item({
      key: `charge-${c.id}`, kind: "individual", description: c.description, term: c.term, academicYear: c.academicYear,
      amountKobo: c.amountKobo, reference: c.reference,
    }, c.status === "paid", (r) => r.chargeId === c.id)),
  ].sort((a, b) => b.academicYear.localeCompare(a.academicYear) || a.term.localeCompare(b.term) || a.description.localeCompare(b.description));
  const totalKobo = items.reduce((n, i) => n + i.amountKobo, 0);
  const paidKobo = items.reduce((n, i) => n + i.paidKobo, 0);
  const pendingKobo = items.filter((i) => i.status === "pending").reduce((n, i) => n + i.amountKobo - i.paidKobo, 0);
  const payments = [
    ...reports.map((r) => ({ reference: r.reference, description: r.description, amountKobo: r.amountKobo, status: r.status, createdAt: r.createdAt })),
    ...onlinePayments.map((p) => ({ reference: p.reference, description: "Online payment (Paystack)", amountKobo: p.amountKobo, status: "confirmed", createdAt: p.createdAt })),
  ];
  return {
    items,
    totals: { totalKobo, paidKobo, pendingKobo, outstandingKobo: totalKobo - paidKobo },
    payments: payments.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
  };
}
