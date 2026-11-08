import assert from "node:assert/strict";
import { test } from "node:test";
import { asReview, staffPublish } from "./exam-review";

const base = { gate: true, wantPublished: true, wasPublished: false, review: "" as const, contentChanged: false };

test("without an exam officer, staff publish as before", () => {
  assert.deepEqual(staffPublish({ ...base, gate: false }), { published: true, review: "", submitted: false });
  assert.deepEqual(staffPublish({ ...base, gate: false, contentChanged: true }), { published: true, review: "", submitted: false });
  assert.deepEqual(staffPublish({ ...base, gate: false, wantPublished: false }), { published: false, review: "", submitted: false });
});

test("with an exam officer, publishing sends the exam to them instead", () => {
  assert.deepEqual(staffPublish(base), { published: false, review: "submitted", submitted: true });
  assert.deepEqual(staffPublish({ ...base, contentChanged: true }), { published: false, review: "submitted", submitted: true });
  assert.deepEqual(staffPublish({ ...base, review: "returned" }), { published: false, review: "submitted", submitted: true });
  // Saving a draft keeps it a draft.
  assert.deepEqual(staffPublish({ ...base, wantPublished: false, contentChanged: true }), { published: false, review: "", submitted: false });
});

test("approval stays with unchanged content: hiding and showing an approved exam needs no new review", () => {
  assert.deepEqual(staffPublish({ ...base, review: "approved" }), { published: true, review: "approved", submitted: false });
  assert.deepEqual(staffPublish({ ...base, wantPublished: false, wasPublished: true, review: "approved" }), { published: false, review: "approved", submitted: false });
  // Editing an approved exam's questions takes the approval away.
  assert.deepEqual(staffPublish({ ...base, review: "approved", contentChanged: true }), { published: false, review: "submitted", submitted: true });
  // Taking back a request returns it to draft.
  assert.deepEqual(staffPublish({ ...base, wantPublished: false, review: "submitted" }), { published: false, review: "", submitted: false });
});

test("only known review states are trusted", () => {
  assert.equal(asReview("approved"), "approved");
  assert.equal(asReview("APPROVED"), "");
  assert.equal(asReview("whatever"), "");
});
