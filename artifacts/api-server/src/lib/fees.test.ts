import assert from "node:assert/strict";
import { test } from "node:test";
import { feeKey, feeStatement } from "./fees";

const at = new Date("2026-10-01T09:00:00Z");
const schedule = (id: number, className: string, amountKobo: number, isActive = true) => ({ id, className, term: "First Term", academicYear: "2026/2027", amountKobo, description: `Fees ${id}`, isActive });
const charge = (id: number, status: string, amountKobo: number) => ({ id, reference: `NWE-FEE-${id}`, term: "First Term", academicYear: "2026/2027", description: `Charge ${id}`, amountKobo, status });
const report = (over: { scheduleId?: number; chargeId?: number; status: string }) => ({ reference: `PAY-${over.status}`, feeType: over.chargeId ? "individual" : "class", scheduleId: over.scheduleId ?? null, chargeId: over.chargeId ?? null, description: "", amountKobo: 1000, status: over.status, createdAt: at });

test("fees: class names and student IDs match ignoring case and spaces", () => {
  assert.equal(feeKey(" jss 1 "), feeKey("JSS1"));
  assert.equal(feeKey("nwe/2026/00001"), "NWE/2026/00001");
});

test("fees: paid, pending and due items add up to the outstanding balance", () => {
  const s = feeStatement("JSS 1",
    [schedule(1, "jss1", 50_000_00), schedule(2, "JSS 1", 5_000_00), schedule(3, "JSS 2", 99_00), schedule(4, "JSS 1", 77_00, false)],
    [charge(10, "due", 3_000_00), charge(11, "paid", 2_000_00), charge(12, "cancelled", 9_00), charge(13, "due", 1_000_00)],
    [report({ scheduleId: 1, status: "confirmed" }), report({ scheduleId: 2, status: "reported" }), report({ chargeId: 13, status: "rejected" })]);
  const byKey = Object.fromEntries(s.items.map((i) => [i.key, i.status]));
  assert.deepEqual(byKey, { "class-1": "paid", "class-2": "pending", "charge-10": "due", "charge-11": "paid", "charge-13": "due" }, "other classes, inactive fees and cancelled charges are left out");
  assert.deepEqual(s.totals, { totalKobo: 61_000_00, paidKobo: 52_000_00, pendingKobo: 5_000_00, outstandingKobo: 9_000_00 });
  assert.equal(s.items.find((i) => i.key === "charge-10")?.reference, "NWE-FEE-10");
  assert.equal(s.payments.length, 3);
});

test("fees: an empty statement is all zeros", () => {
  assert.deepEqual(feeStatement("JSS 1", [], [], []).totals, { totalKobo: 0, paidKobo: 0, pendingKobo: 0, outstandingKobo: 0 });
});
