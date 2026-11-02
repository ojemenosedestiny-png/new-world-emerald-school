import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { allocate, amountProblem, chosen, newPaymentReference, oldestFirst, selectionProblem, settle, type OutstandingItem } from "./parent-payments";
import { validWebhookSignature } from "./paystack";
import { feeStatement } from "./fees";

const item = (studentId: number, itemKey: string, outstandingKobo: number, academicYear = "2026/2027", term = "First Term"): OutstandingItem => ({
  studentId, studentCode: `NWE-${studentId}`, studentName: `Child ${studentId}`, className: "JSS 1", itemKey, description: "School fees", term, academicYear, outstandingKobo,
});

test("money goes to the oldest debts first and never beyond what each item owes", () => {
  const items = [item(1, "class-2", 50_000_00, "2026/2027", "Second Term"), item(1, "class-1", 30_000_00, "2026/2027", "First Term"), item(2, "class-9", 20_000_00, "2025/2026", "Third Term")];
  assert.deepEqual(oldestFirst(items).map((i) => i.itemKey), ["class-9", "class-1", "class-2"]);
  const r = allocate(items, 60_000_00);
  assert.deepEqual(r.allocations.map((a) => [a.itemKey, a.amountKobo]), [["class-9", 20_000_00], ["class-1", 30_000_00], ["class-2", 10_000_00]]);
  assert.equal(r.allocatedKobo, 60_000_00);
});

test("an overpayment goes back into the wallet, and the wallet pays first next time", () => {
  // Owes 80,000; pays 100,000 by card with an empty wallet: 20,000 goes to the wallet.
  const first = settle(100_000_00, 0, [item(1, "class-1", 80_000_00)]);
  assert.deepEqual([first.allocatedKobo, first.walletUsedKobo, first.walletCreditKobo, first.balanceAfterKobo], [80_000_00, 0, 20_000_00, 20_000_00]);
  // Next term owes 90,000: the 20,000 wallet completes the 70,000 card payment.
  const second = settle(70_000_00, first.balanceAfterKobo, [item(1, "class-2", 90_000_00)]);
  assert.deepEqual([second.allocatedKobo, second.walletUsedKobo, second.walletCreditKobo, second.balanceAfterKobo], [90_000_00, 20_000_00, 0, 0]);
  // A wallet-only payment uses only what is owed and keeps the rest.
  const third = settle(0, 50_000_00, [item(1, "class-3", 15_000_00)]);
  assert.deepEqual([third.walletUsedKobo, third.walletCreditKobo, third.balanceAfterKobo], [15_000_00, 0, 35_000_00]);
});

test("a part payment is applied and the rest of the item stays owed", () => {
  const s = settle(30_000_00, 0, [item(1, "class-1", 80_000_00)]);
  assert.deepEqual([s.allocatedKobo, s.walletCreditKobo], [30_000_00, 0]);
  const statement = feeStatement("JSS 1", [{ id: 1, className: "JSS 1", term: "First Term", academicYear: "2026/2027", amountKobo: 80_000_00, description: "Tuition", isActive: true }], [], [],
    s.allocations.map((a) => ({ itemKey: a.itemKey, amountKobo: a.amountKobo })));
  assert.deepEqual([statement.items[0].paidKobo, statement.items[0].status, statement.totals.outstandingKobo], [30_000_00, "due", 50_000_00]);
  const full = feeStatement("JSS 1", [{ id: 1, className: "JSS 1", term: "First Term", academicYear: "2026/2027", amountKobo: 80_000_00, description: "Tuition", isActive: true }], [], [],
    [{ itemKey: "class-1", amountKobo: 30_000_00 }, { itemKey: "class-1", amountKobo: 50_000_00 }]);
  assert.deepEqual([full.items[0].paidKobo, full.items[0].status, full.totals.outstandingKobo], [80_000_00, "paid", 0]);
});

test("a parent can only pay for their own children's unpaid fees, once each", () => {
  const available = [item(1, "class-1", 100), item(2, "charge-4", 100)];
  assert.equal(selectionProblem([], available), "Choose at least one fee to pay.");
  assert.equal(selectionProblem([{ studentId: 1, itemKey: "class-1" }], available), null);
  assert.match(selectionProblem([{ studentId: 3, itemKey: "class-1" }], available)!, /not for your child/);
  assert.match(selectionProblem([{ studentId: 1, itemKey: "class-1" }, { studentId: 1, itemKey: "class-1" }], available)!, /twice/);
  assert.deepEqual(chosen([{ studentId: 2, itemKey: "charge-4" }], available).map((i) => i.itemKey), ["charge-4"]);
});

test("card amounts: at least ₦100, whole kobo, and zero only when the wallet can pay", () => {
  assert.equal(amountProblem(10_000, 50_000, 0), null);
  assert.match(amountProblem(5_000, 50_000, 0)!, /₦100/);
  assert.match(amountProblem(-1, 50_000, 0)!, /valid/);
  assert.match(amountProblem(1.5, 50_000, 0)!, /valid/);
  assert.equal(amountProblem(0, 50_000, 20_000), null);
  assert.match(amountProblem(0, 50_000, 0)!, /Enter the amount/);
});

test("payment references are unique and cannot be guessed", () => {
  const a = newPaymentReference(new Date("2026-11-02T10:00:00Z"));
  assert.match(a, /^NWE-20261102-[A-F0-9]{10}$/);
  assert.notEqual(a, newPaymentReference(new Date("2026-11-02T10:00:00Z")));
});

test("only notices signed with the school's Paystack secret are accepted", () => {
  const key = "sk_test_abc123";
  const body = Buffer.from(JSON.stringify({ event: "charge.success", data: { reference: "NWE-20261102-ABCDEF1234" } }));
  const good = createHmac("sha512", key).update(body).digest("hex");
  assert.equal(validWebhookSignature(body, good, key), true);
  assert.equal(validWebhookSignature(Buffer.from(body.toString() + " "), good, key), false, "a changed body fails");
  assert.equal(validWebhookSignature(body, createHmac("sha512", "sk_test_other").update(body).digest("hex"), key), false);
  assert.equal(validWebhookSignature(body, undefined, key), false);
  assert.equal(validWebhookSignature(body, good, ""), false, "no secret configured: nothing is trusted");
});
