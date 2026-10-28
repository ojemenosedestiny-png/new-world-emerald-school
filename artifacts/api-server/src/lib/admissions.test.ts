import assert from "node:assert/strict";
import { test } from "node:test";
import { CreateAdmissionApplicationBody } from "@workspace/api-zod";

const base = { studentFirstName: "Ada", studentLastName: "Obi", grade: "Nursery", entryYear: "2026/2027", guardianEmail: "parent@example.test", guardianPhone: "+2348000000000" };

test("admissions: an application may list the documents ready, by known names only", () => {
  assert.equal(CreateAdmissionApplicationBody.safeParse(base).success, true, "documents are optional");
  assert.deepEqual(CreateAdmissionApplicationBody.parse({ ...base, documentsReady: ["birth", "hiv"] }).documentsReady, ["birth", "hiv"]);
  assert.equal(CreateAdmissionApplicationBody.safeParse({ ...base, documentsReady: ["scan-of-result.pdf"] }).success, false, "no free text or files");
  assert.equal(CreateAdmissionApplicationBody.safeParse({ ...base, documentsReady: Array(11).fill("birth") }).success, false);
});
