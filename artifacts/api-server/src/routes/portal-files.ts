import express, { Router } from "express";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, portalFiles, portalClasses, portalMaterials, portalExams, portalAttempts } from "@workspace/db";
import { check, classAllowed, portalActor, studentOnly } from "../lib/portal-auth";
import { ObjectStorageService, objectStorageClient } from "../lib/objectStorage";
import { serveObject } from "../lib/serve-object";
import { extractPdfText, questionsFromText } from "../lib/portal-pdf";

export const portalFilesRouter = Router();
const storage = new ObjectStorageService();
function objectFile(objectName: string) {
  const dir = storage.getPrivateObjectDir().replace(/^\/+|\/+$/g, "");
  const [bucket, ...prefix] = dir.split("/");
  return objectStorageClient.bucket(bucket).file([...prefix, "portal-private", objectName].join("/"));
}
const importing = new Set<string>();
portalFilesRouter.post("/import", async (req, res, next) => {
  // Authorize before accepting up to 15MB into memory.
  try {
    classAllowed(await portalActor(req), Number(req.query.classId));
    next();
  } catch (error) { next(error); }
}, express.raw({ type: "application/pdf", limit: "15mb" }), async (req, res) => {
  const actor = await portalActor(req);
  const classId = Number(req.query.classId);
  classAllowed(actor, classId);
  const [schoolClass] = await db.select().from(portalClasses).where(eq(portalClasses.id, classId));
  check(schoolClass, "Class not found.", 404);
  check(Buffer.isBuffer(req.body) && req.body.length > 5 && req.body.subarray(0, 5).toString() === "%PDF-", "Upload a valid PDF document (maximum 15MB).");
  const importKey = req.dbUser?.id || actor.name;
  check(!importing.has(importKey), "A PDF is already being processed. Please wait.", 429);
  importing.add(importKey);
  try {
    const id = randomUUID();
    let text = "", warning = "";
    try { text = await extractPdfText(req.body); }
    catch (error) {
      req.log.warn({ err: error }, "Portal PDF text extraction unavailable");
      warning = "Automatic extraction could not read this PDF. Use original-PDF mode and add answer slots, or upload a text-based PDF.";
    }
    const questions = text ? questionsFromText(text) : [];
    if (!questions.length && !warning) warning = "No numbered questions were detected. This may be a scanned paper. Use original-PDF mode with answer slots, or upload a text-based PDF.";
    if (questions.length) warning = "Draft extraction only: review every question, choice, mark and answer key. Scanned images, diagrams and complex layouts are not converted. The original PDF must not contain an answer key if shown to students.";
    const file = objectFile(id);
    await file.save(req.body, { contentType: "application/pdf", resumable: false, metadata: { cacheControl: "private, no-store" } });
    try { await db.insert(portalFiles).values({ id, classId, objectName: id }); }
    catch (error) { await file.delete({ ignoreNotFound: true }); throw error; }
    res.json({ fileId: id, questions, warning, extractedText: text });
  } finally { importing.delete(importKey); }
});
portalFilesRouter.get("/files/:id", async (req, res) => {
  const actor = await portalActor(req);
  const [file] = await db.select().from(portalFiles).where(eq(portalFiles.id, String(req.params.id)));
  check(file, "Document not found.", 404);
  if (actor.role === "admin" || actor.role === "teacher") classAllowed(actor, file.classId);
  else {
    const student = studentOnly(actor);
    check(student.classId === file.classId, "Document not found.", 404);
    const [material] = await db.select({ id: portalMaterials.id }).from(portalMaterials)
      .where(and(eq(portalMaterials.fileId, file.id), eq(portalMaterials.classId, student.classId), eq(portalMaterials.published, true))).limit(1);
    if (!material) {
      const rows = await db.select({ attempt: portalAttempts, exam: portalExams }).from(portalAttempts)
        .innerJoin(portalExams, eq(portalExams.id, portalAttempts.examId))
        .where(and(eq(portalAttempts.studentId, student.id), eq(portalExams.classId, student.classId), eq(portalExams.fileId, file.id), eq(portalExams.mode, "pdf")));
      check(rows.some(({ attempt }) => attempt.status === "in_progress" && attempt.deadline.getTime() > Date.now()), "This exam document is not available outside an active attempt.", 403);
    }
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", 'inline; filename="school-document.pdf"');
  await serveObject(req, res, storage, async () => objectFile(file.objectName), { noStore: true });
});
