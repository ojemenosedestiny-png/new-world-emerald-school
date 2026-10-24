/** Case- and space-insensitive key, matching how the fee forms compare student IDs and class names. */
export const feeKey = (value: string) => value.trim().toLocaleUpperCase().replace(/\s+/g, "");

export type FeeItemStatus = "due" | "pending" | "paid";
type Schedule = { id: number; className: string; term: string; academicYear: string; amountKobo: number; description: string; isActive: boolean };
type Charge = { id: number; reference: string; term: string; academicYear: string; description: string; amountKobo: number; status: string };
type Report = { reference: string; feeType: string; scheduleId: number | null; chargeId: number | null; description: string; amountKobo: number; status: string; createdAt: Date };

const AWAITING = new Set(["payment_requested", "reported"]);

/**
 * One student's fee statement: active class fees for their class plus individual charges, each marked paid
 * (office confirmed), pending (a payment report awaits review) or due. Cancelled charges are left out.
 */
export function feeStatement(className: string, schedules: Schedule[], charges: Charge[], reports: Report[]) {
  const cls = feeKey(className);
  const status = (confirmed: boolean, match: (r: Report) => boolean): FeeItemStatus =>
    confirmed || reports.some((r) => match(r) && r.status === "confirmed") ? "paid" : reports.some((r) => match(r) && AWAITING.has(r.status)) ? "pending" : "due";
  const items = [
    ...schedules.filter((s) => s.isActive && feeKey(s.className) === cls).map((s) => ({
      key: `class-${s.id}`, kind: "class" as const, description: s.description || "School fees", term: s.term, academicYear: s.academicYear,
      amountKobo: s.amountKobo, reference: null, status: status(false, (r) => r.scheduleId === s.id),
    })),
    ...charges.filter((c) => c.status !== "cancelled").map((c) => ({
      key: `charge-${c.id}`, kind: "individual" as const, description: c.description, term: c.term, academicYear: c.academicYear,
      amountKobo: c.amountKobo, reference: c.reference, status: status(c.status === "paid", (r) => r.chargeId === c.id),
    })),
  ].sort((a, b) => b.academicYear.localeCompare(a.academicYear) || a.term.localeCompare(b.term) || a.description.localeCompare(b.description));
  const sum = (s?: FeeItemStatus) => items.filter((i) => !s || i.status === s).reduce((n, i) => n + i.amountKobo, 0);
  const totalKobo = sum();
  const paidKobo = sum("paid");
  return {
    items,
    totals: { totalKobo, paidKobo, pendingKobo: sum("pending"), outstandingKobo: totalKobo - paidKobo },
    payments: [...reports].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((r) => ({
      reference: r.reference, description: r.description, amountKobo: r.amountKobo, status: r.status, createdAt: r.createdAt.toISOString(),
    })),
  };
}
