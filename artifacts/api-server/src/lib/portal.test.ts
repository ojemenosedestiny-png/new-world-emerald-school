import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, portalClasses, portalStudents, portalTeachers, portalExams, portalAttempts,
  portalSessions, portalMaterials, portalNotices, portalFiles,
  type PortalQuestionData,
} from "@workspace/db";
import type { PortalPdfImport } from "@workspace/api-zod";
import portalRouter from "../routes/portal";
import { hashPassword, verifyPassword, classAllowed } from "./portal-auth";
import { automaticMarks, validateQuestions } from "./portal-assessment";
import { questionsFromText } from "./portal-pdf";
import { ObjectStorageService } from "./objectStorage";
import { objectStorageClient } from "./objectStorage";

function samplePdf() {
  const stream = "BT /F1 12 Tf 50 750 Td 16 TL (1. What is 2 + 2?) Tj T* (A. Three) Tj T* (B. Four) Tj T* (2. Explain your answer.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((value, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((v) => `${String(v).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

test("question conversion preserves choices and never invents a correct answer", () => {
  const questions = questionsFromText("School paper\n1. What is 2 + 2?\nA. Three\nB. Four\nC. Five\n2) Explain photosynthesis.\nAnswer Key\n1. B");
  assert.equal(questions.length, 2);
  assert.deepEqual(questions[0].options, ["Three", "Four", "Five"]);
  assert.equal(questions[0].correctAnswer, null);
  assert.equal(questions[1].type, "written");
  assert.equal(questionsFromText("An unnumbered scanned document").length, 0);
});
test("publishing needs a valid answer key and classroom access is enforced", () => {
  const question = { id: "q", type: "mcq" as const, text: "Choose", options: ["One", "Two"], marks: 2, correctAnswer: null };
  validateQuestions([question], false);
  assert.throws(() => validateQuestions([question], true));
  assert.throws(() => validateQuestions([{ ...question, correctAnswer: 4 }], true));
  assert.throws(() => validateQuestions([question, question], false));
  assert.equal(automaticMarks([{ ...question, correctAnswer: 1 }], { q: "1" })[0].score, 2);
  assert.equal(automaticMarks([{ ...question, correctAnswer: 1 }], {})[0].score, 0);
  const teacher = { role: "teacher" as const, classIds: [1], name: "Teacher", mustChangePassword: false };
  classAllowed(teacher, 1);
  assert.throws(() => classAllowed(teacher, 2));
  assert.throws(() => classAllowed({ ...teacher, role: "guest" }, 1));
});
test("passwords are salted and verified without plaintext storage", async () => {
  const a = await hashPassword("Individual-temporary-543!");
  const b = await hashPassword("Individual-temporary-543!");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("Individual-temporary-543!", a), true);
  assert.equal(await verifyPassword("Wrong", a), false);
});
test("portal-private documents are rejected by the legacy public object route", async () => {
  await assert.rejects(() => new ObjectStorageService().getObjectEntityFile("/objects/portal-private/a-document"));
});

test("student enrolment, exams, grading, isolation and revocation work end-to-end", async () => {
  // Synthetic identity exists only inside this isolated test process, not Clerk,
  // the real server, or its school approval configuration.
  const previous = process.env.SCHOOL_ADMIN_EMAILS;
  process.env.SCHOOL_ADMIN_EMAILS = "portal-unit-admin@example.test";
  const marker = `QA-PORTAL-${randomUUID().slice(0, 8)}`.toUpperCase();
  const classIds: number[] = [];
  const fileIds: string[] = [];
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    if (req.headers["x-test-admin"] === marker) {
      req.dbUser = { id: "synthetic-unit-test" } as NonNullable<typeof req.dbUser>;
      req.identity = { email: "portal-unit-admin@example.test", emailVerified: true };
    }
    next();
  });
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  async function call(path: string, method = "GET", body?: unknown, cookie = "", admin = false) {
    const response = await fetch(root + path, {
      method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(admin ? { "X-Test-Admin": marker } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // This test exercises several response contracts; each accessed field is
    // checked below against its endpoint's expected value.
    const data = (response.status === 204 ? {} : await response.json()) as {
      id: number; role: string; mustChangePassword: boolean; status: string;
      answers: Record<string, string>; questions: unknown[]; fileId: string | null;
      score?: number; resultsReleased: boolean;
    };
    return { status: response.status, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "", data };
  }
  const command = (body: unknown) => call("/manage", "POST", body, "", true);
  try {
    assert.equal((await call("/manage")).status, 401);
    assert.equal((await command({ action: "saveClass", schoolClass: { name: marker } })).status, 200);
    const [c] = await db.select().from(portalClasses).where(eq(portalClasses.name, marker)); classIds.push(c.id);
    const pdfResponse = await fetch(root + `/import?classId=${c.id}`, { method: "POST", headers: { "Content-Type": "application/pdf", "X-Test-Admin": marker }, body: samplePdf() });
    const imported = await pdfResponse.json() as PortalPdfImport;
    assert.equal(pdfResponse.status, 200, JSON.stringify(imported));
    fileIds.push(imported.fileId);
    assert.equal(imported.questions.length, 2, imported.warning);
    assert.equal(imported.questions[0].correctAnswer, null);
    assert.equal((await fetch(root + `/files/${imported.fileId}`)).status, 401);
    const [otherClass] = await db.insert(portalClasses).values({ name: `${marker}-OTHER` }).returning(); classIds.push(otherClass.id);
    const temporary = "Individual-Temp-5271!";
    const newPassword = "Individual-New-6842!";
    assert.equal((await command({ action: "saveStudent", student: { studentId: marker, name: "Portal QA student", classId: c.id, active: true, password: temporary } })).status, 200);
    const [student] = await db.select().from(portalStudents).where(eq(portalStudents.studentId, marker));
    assert.notEqual(student.passwordHash, temporary);
    let login = await call("/session", "POST", { studentId: marker.toLowerCase(), password: temporary });
    assert.equal(login.status, 200); assert.equal(login.data.mustChangePassword, true);
    assert.equal((await call("/student", "GET", undefined, login.cookie)).status, 403);
    assert.equal((await call("/password", "PUT", { currentPassword: "Wrong", newPassword }, login.cookie)).status, 400);
    const changed = await call("/password", "PUT", { currentPassword: temporary, newPassword }, login.cookie);
    assert.equal(changed.status, 204);
    assert.equal((await call("/session", "GET", undefined, login.cookie)).data.role, "guest");
    const cookie = changed.cookie;
    assert.equal((await call("/session", "GET", undefined, cookie)).data.mustChangePassword, false);
    assert.equal((await command({ action: "saveMaterial", material: { title: marker, subject: "Maths", classId: c.id, body: "Revision", fileId: imported.fileId, published: true } })).status, 200);
    const revisionPdf = await fetch(root + `/files/${imported.fileId}`, { headers: { Cookie: cookie } });
    assert.equal(revisionPdf.status, 200);
    assert.equal(revisionPdf.headers.get("cache-control"), "private, no-store");
    assert.equal((await revisionPdf.text()).startsWith("%PDF"), true);
    assert.equal((await call("/manage", "GET", undefined, cookie)).status, 403);
    const questions: PortalQuestionData[] = [
      { id: "mcq-1", type: "mcq", text: "What is 2 + 2?", options: ["3", "4"], correctAnswer: 1, marks: 2 },
      { id: "written-1", type: "written", text: "Explain how you added.", options: [], correctAnswer: null, marks: 3, rubric: "Explain addition." },
    ];
    const examData = {
      title: marker, subject: "Mathematics", classId: c.id, durationMinutes: 20,
      startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 20 * 60_000).toISOString(),
      mode: "interactive", fileId: null, instructions: "Answer both questions", questions, published: true, resultsReleased: false,
    };
    assert.equal((await command({ action: "saveExam", exam: examData })).status, 200);
    const [exam] = await db.select().from(portalExams).where(eq(portalExams.title, marker));
    const dashboard = await call("/student", "GET", undefined, cookie);
    assert.equal(dashboard.status, 200);
    assert.equal(JSON.stringify(dashboard.data).includes("correctAnswer"), false);
    const start = await call(`/exams/${exam.id}/start`, "POST", undefined, cookie);
    assert.equal(start.status, 200);
    assert.equal(start.data.questions.length, 2);
    assert.equal(JSON.stringify(start.data).includes("rubric"), false);
    assert.equal(start.data.fileId, null);
    const attemptId = start.data.id;
    assert.equal((await call(`/exams/${exam.id}/start`, "POST", undefined, cookie)).data.id, attemptId);
    assert.equal((await command({ action: "saveExam", exam: { ...examData, id: exam.id } })).status, 409);
    const answers = { "mcq-1": "1", "written-1": "I added two objects to another two." };
    assert.equal((await call(`/attempts/${attemptId}`, "PUT", { answers }, cookie)).status, 200);
    assert.deepEqual((await call(`/attempts/${attemptId}`, "GET", undefined, cookie)).data.answers, answers);
    assert.equal((await call(`/attempts/${attemptId}`, "PUT", { answers: { unknown: "x" } }, cookie)).status, 400);
    const [other] = await db.insert(portalStudents).values({ studentId: `${marker}-OTHER`, name: "Other QA student", classId: otherClass.id, passwordHash: await hashPassword(temporary), mustChangePassword: false }).returning();
    const otherLogin = await call("/session", "POST", { studentId: other.studentId, password: temporary });
    assert.equal((await call(`/attempts/${attemptId}`, "GET", undefined, otherLogin.cookie)).status, 404);
    assert.equal((await call(`/exams/${exam.id}/start`, "POST", undefined, otherLogin.cookie)).status, 404);
    const submitted = await call(`/attempts/${attemptId}/submit`, "POST", { answers }, cookie);
    assert.equal(submitted.data.status, "submitted");
    assert.equal(submitted.data.score, undefined);
    assert.equal((await command({ action: "grade", grade: { attemptId, marks: [{ questionId: "written-1", score: 4, feedback: "" }] } })).status, 400);
    assert.equal((await command({ action: "grade", grade: { attemptId, marks: [{ questionId: "written-1", score: 2, feedback: "Good explanation." }] } })).status, 200);
    assert.equal((await call(`/attempts/${attemptId}`, "GET", undefined, cookie)).data.score, undefined);
    assert.equal((await command({ action: "examStatus", examStatus: { id: exam.id, published: true, resultsReleased: true } })).status, 400);
    await db.update(portalExams).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(portalExams.id, exam.id));
    assert.equal((await command({ action: "examStatus", examStatus: { id: exam.id, published: true, resultsReleased: true } })).status, 200);
    const result = await call(`/attempts/${attemptId}`, "GET", undefined, cookie);
    assert.equal(result.data.score, 4);
    assert.equal(result.data.resultsReleased, true);
    assert.equal((await command({ action: "grade", grade: { attemptId, marks: [{ questionId: "written-1", score: 1, feedback: "" }] } })).status, 409);
    // Expiry uses the server deadline and ignores late answer replacements.
    const [timedExam] = await db.insert(portalExams).values({ ...examData, title: `${marker}-TIME`, startsAt: new Date(examData.startsAt), endsAt: new Date(examData.endsAt), questions: [questions[0]] }).returning();
    const timed = await call(`/exams/${timedExam.id}/start`, "POST", undefined, cookie);
    await db.update(portalAttempts).set({ answers: { "mcq-1": "0" }, deadline: new Date(Date.now() - 1000) }).where(eq(portalAttempts.id, timed.data.id));
    const late = await call(`/attempts/${timed.data.id}`, "PUT", { answers: { "mcq-1": "1" } }, cookie);
    assert.equal(late.data.status, "marked");
    assert.equal(late.data.answers["mcq-1"], "0");
    // Resetting credentials revokes all sessions and requires a new password.
    assert.equal((await command({ action: "saveStudent", student: { id: student.id, studentId: marker, name: student.name, classId: c.id, active: true, password: "Reset-Individual-9821!" } })).status, 200);
    assert.equal((await call("/session", "GET", undefined, cookie)).data.role, "guest");
    assert.equal((await call("/session", "POST", { studentId: marker, password: newPassword })).status, 401);
    login = await call("/session", "POST", { studentId: marker, password: "Reset-Individual-9821!" });
    assert.equal(login.data.mustChangePassword, true);
    assert.equal((await command({ action: "saveStudent", student: { id: student.id, studentId: marker, name: student.name, classId: c.id, active: false } })).status, 200);
    assert.equal((await call("/session", "GET", undefined, login.cookie)).data.role, "guest");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (classIds.length) {
      const dir = new ObjectStorageService().getPrivateObjectDir().replace(/^\/+|\/+$/g, "");
      const [bucket, ...prefix] = dir.split("/");
      for (const id of fileIds) await objectStorageClient.bucket(bucket).file([...prefix, "portal-private", id].join("/")).delete({ ignoreNotFound: true });
      const students = await db.select({ id: portalStudents.id }).from(portalStudents).where(inArray(portalStudents.classId, classIds));
      if (students.length) {
        await db.delete(portalSessions).where(inArray(portalSessions.studentId, students.map((s) => s.id)));
        await db.delete(portalAttempts).where(inArray(portalAttempts.studentId, students.map((s) => s.id)));
      }
      await db.delete(portalExams).where(inArray(portalExams.classId, classIds));
      await db.delete(portalMaterials).where(inArray(portalMaterials.classId, classIds));
      await db.delete(portalNotices).where(inArray(portalNotices.classId, classIds));
      await db.delete(portalFiles).where(inArray(portalFiles.classId, classIds));
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    if (previous === undefined) delete process.env.SCHOOL_ADMIN_EMAILS;
    else process.env.SCHOOL_ADMIN_EMAILS = previous;
    await pool.end();
  }
});
