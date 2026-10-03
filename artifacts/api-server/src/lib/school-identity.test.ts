import assert from "node:assert/strict";
import { test } from "node:test";
import { schoolUserId } from "./school-identity";

test("migrated users resolve to their preserved local ID, not Clerk's subject", () => {
  assert.equal(schoolUserId({ sub: "user_native", userId: "legacy-school-id" }), "legacy-school-id");
});

test("new users resolve to the managed userId claim", () => {
  assert.equal(schoolUserId({ sub: "user_new", userId: "user_new" }), "user_new");
});

test("missing or invalid bridge claims fail closed instead of orphaning school data", () => {
  for (const claims of [null, undefined, {}, { sub: "user_native" }, { userId: "" }, { userId: 123 }]) {
    assert.equal(schoolUserId(claims), null);
  }
});