import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanBody, staffMayOpen, threadTitle } from "./messages";

test("messages: the office sees every conversation, teachers only their classes' class channel", () => {
  const teacher = { role: "teacher" as const, classIds: [3, 4] };
  assert.equal(staffMayOpen(teacher, "class", 3), true);
  assert.equal(staffMayOpen(teacher, "class", 9), false, "another class");
  assert.equal(staffMayOpen(teacher, "office", 3), false, "office conversations are for the office");
  assert.equal(staffMayOpen({ role: "admin", classIds: [] }, "office", 9), true);
  assert.equal(staffMayOpen({ role: "admin", classIds: [] }, "class", 9), true);
  assert.equal(staffMayOpen({ role: "student", classIds: [3] }, "class", 3), false);
  assert.equal(staffMayOpen({ role: "guest", classIds: [] }, "class", 3), false);
});

test("messages: bodies are trimmed, cleaned and capped", () => {
  assert.equal(cleanBody("  Hello\r\nteacher  "), "Hello\nteacher");
  assert.equal(cleanBody("a\n\n\n\n\nb"), "a\n\nb");
  assert.equal(cleanBody("bell\u0007"), "bell");
  assert.equal(cleanBody("   "), null);
  assert.equal(cleanBody("x".repeat(1000))?.length, 1000);
  assert.equal(cleanBody("x".repeat(1001)), null);
  assert.equal(threadTitle("class", "JSS 1"), "Class teacher (JSS 1)");
  assert.equal(threadTitle("office", "JSS 1"), "School office");
});
