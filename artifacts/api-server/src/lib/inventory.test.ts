import assert from "node:assert/strict";
import { test } from "node:test";
import { applyMove, itemProblem, stockStatus, teacherMayEdit, teacherMaySee } from "./inventory";

test("inventory: stock status is out at zero and low at or below the reorder level", () => {
  assert.equal(stockStatus({ quantity: 0, reorderLevel: 5 }), "out");
  assert.equal(stockStatus({ quantity: 5, reorderLevel: 5 }), "low");
  assert.equal(stockStatus({ quantity: 6, reorderLevel: 5 }), "ok");
  assert.equal(stockStatus({ quantity: 1, reorderLevel: 0 }), "ok", "no reorder level, no warning");
});

test("inventory: movements add, take away, set a count, and never go below zero", () => {
  assert.deepEqual(applyMove(10, "received", 5), { change: 5, after: 15 });
  assert.deepEqual(applyMove(10, "returned", 2), { change: 2, after: 12 });
  assert.deepEqual(applyMove(10, "issued", 4), { change: -4, after: 6 });
  assert.deepEqual(applyMove(10, "damaged", 1), { change: -1, after: 9 });
  assert.deepEqual(applyMove(10, "lost", 10), { change: -10, after: 0 });
  assert.deepEqual(applyMove(10, "count", 7), { change: -3, after: 7 });
  assert.deepEqual(applyMove(10, "count", 0), { change: -10, after: 0 });
  assert.deepEqual(applyMove(10, "condition", 0), { change: 0, after: 10 });
  assert.match((applyMove(3, "issued", 4) as { problem: string }).problem, /Only 3 in stock/);
  assert.ok("problem" in applyMove(3, "issued", 0));
  assert.ok("problem" in applyMove(3, "received", 1.5));
  assert.ok("problem" in applyMove(3, "received", -2));
});

test("inventory: item details are checked, and teachers edit only their own classes' stock", () => {
  const item = { name: "Chairs", category: "Furniture", location: "JSS 1", unit: "pieces", quantity: 30, reorderLevel: 5, condition: "good", classId: 1, notes: "" };
  assert.equal(itemProblem(item), null);
  assert.match(itemProblem({ ...item, name: " " })!, /name/);
  assert.match(itemProblem({ ...item, condition: "broken" })!, /condition/);
  assert.match(itemProblem({ ...item, reorderLevel: -1 })!, /Reorder level/);
  assert.equal(teacherMayEdit({ classId: 1 }, [1, 2]), true);
  assert.equal(teacherMayEdit({ classId: 3 }, [1, 2]), false);
  assert.equal(teacherMayEdit({ classId: null }, [1, 2]), false, "school-wide stock is the office's");
  assert.equal(teacherMaySee({ classId: null }, [1]), true);
  assert.equal(teacherMaySee({ classId: 3 }, [1]), false);
});
