import express, { Router } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import { db, portalFiles, portalClasses, portalMaterials, portalExams, portalAttempts, portalAssignments, portalStudents, portalTimetables } from "@workspace/db";
import { check, classAllowed, portalActor, studentOnly, type PortalActor } from "../lib/portal-auth";
import { parentEmail } from "./portal-parent";
import { canPublishExams } from "../lib/website-admin";
import { ObjectStorageService, objectStorageClient } from "../lib/objectStorage";
import { serveObject } from "../lib/serve-object";
import { diagramContentType, paperFromLayout, readPdfLayout, type PdfLayout } from "../lib/portal-pdf";
import { cloudinaryReady, deleteFromCloudinary, downloadUrl, pipeFromCloudinary, uploadToCloudinary } from "../lib/cloudinary";

// PDFs stored on Cloudinary are private and named "cloudinary:<public id>"; others are in the bucket.
const CLOUDINARY_PREFIX = "cloudinary:";
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_DIAGRAM_BYTES = 3 * 1024 * 1024;

export const portalFilesRouter = Router();
const storage = new ObjectStorageService();
function objectFile(objectName: string) {
  const dir = storage.getPrivateObjectDir().replace(/^\/+|\/+$/g, "");
  const [bucket, ...prefix] = dir.split("/");
  return objectStorageClient.bucket(bucket).file([...prefix, "portal-private", objectName].join("/"));
}
/**
 * Stores a private file for a class. Papers keep their original names (a bare id in the bucket,
 * <id>.pdf on Cloudinary); diagram pictures carry an image extension so they are never served as papers.
 */
async function storeClassFile(body: Buffer, classId: number | null, ext: "pdf" | "png" | "jpg" | "webp", kind: "diagram" | "document" = "diagram") {
  const id = randomUUID();
  const contentType = ext === "pdf" ? "application/pdf" : diagramContentType("." + ext)!;
  // A picture uploaded as a document (a timetable photo) is named doc-<id>; exam diagrams stay diagram-<id>.
  let objectName = ext === "pdf" ? id : `${kind === "document" ? "doc" : "diagram"}-${id}.${ext}`;
  let discard: () => Promise<unknown>;
  if (cloudinaryReady()) {
    const publicId = ext === "pdf" ? `nwe/portal/files/${id}.pdf` : kind === "document" ? `nwe/portal/files/${id}.${ext}` : `nwe/portal/diagrams/${id}.${ext}`;
    await uploadToCloudinary(body, { publicId, resourceType: "raw", visibility: "private", maxBytes: ext === "pdf" || kind === "document" ? MAX_PDF_BYTES : MAX_DIAGRAM_BYTES });
    objectName = CLOUDINARY_PREFIX + publicId;
    discard = () => deleteFromCloudinary(publicId, "raw", "private");
  } else {
    const file = objectFile(objectName);
    await file.save(body, { contentType, resumable: false, metadata: { cacheControl: "private, no-store" } });
    discard = () => file.delete({ ignoreNotFound: true });
  }
  try { await db.insert(portalFiles).values({ id, classId, objectName }); }
  catch (error) { await discard().catch(() => {}); throw error; }
  return id;
}
// Authorize before accepting a large body into memory.
const classFirst: express.RequestHandler = async (req, _res, next) => {
  try {
    classAllowed(await portalActor(req), Number(req.query.classId));
    next();
  } catch (error) { next(error); }
};
const importing = new Set<string>();
portalFilesRouter.post("/import", classFirst, express.raw({ type: "application/pdf", limit: "15mb" }), async (req, res) => {
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
    let layout: PdfLayout | null = null, warning = "";
    try { layout = await readPdfLayout(req.body, { render: true }); }
    catch (error) {
      req.log.warn({ err: error }, "Portal PDF text extraction unavailable");
      warning = "Automatic extraction could not read this PDF. Use original-PDF mode and add answer slots, or upload a text-based PDF.";
    }
    const paper = layout ? paperFromLayout(layout) : null;
    const questions = paper?.questions ?? [];
    if (!questions.length && !warning) warning = "No numbered questions were detected. This may be a scanned paper. Use original-PDF mode with answer slots, or upload a text-based PDF.";
    if (questions.length) warning = "Draft extraction only: review every question, choice, passage, diagram, mark and answer key. Correct answers are never filled in from the PDF. Scanned pages are not converted. The original PDF must not contain an answer key if shown to students.";
    const fileId = await storeClassFile(req.body, classId, "pdf");
    // Each drawing is cropped from the page and attached to its question; anything not attached is reported.
    const notes: { question: number | null; message: string }[] = [];
    for (const [k, diagram] of (layout?.diagrams ?? []).entries()) {
      const q = paper!.diagramQuestion[k];
      const page = diagram.page + 1;
      if (q == null) { notes.push({ question: null, message: `A diagram on page ${page} could not be matched to a question. It is still in the original PDF: attach it to the right question manually.` }); continue; }
      const label = `Question ${paper!.numbers[q]}`;
      if (questions[q].diagramFileId) { notes.push({ question: q, message: `${label}: another diagram on page ${page} was not imported. Use Original PDF mode or attach a picture with both drawings manually.` }); continue; }
      let stored: string | null = null;
      if (diagram.image) {
        try { stored = await storeClassFile(diagram.image, classId, "png"); }
        catch (error) { req.log.warn({ err: error }, "Portal PDF diagram could not be stored"); }
      }
      if (stored) {
        questions[q].diagramFileId = stored;
        notes.push({ question: q, message: `${label}: the diagram on page ${page} was attached as a picture. Check it against the original PDF.` });
      } else notes.push({ question: q, message: `${label}: a diagram on page ${page} was not imported. Use Original PDF mode or attach the diagram manually.` });
    }
    res.json({ fileId, questions, warning, extractedText: paper?.text ?? "", passages: paper?.passages ?? [], notes });
  } finally { importing.delete(importKey); }
});
function imageKind(body: unknown): "png" | "jpg" | "webp" | null {
  if (!Buffer.isBuffer(body) || body.length < 12) return null;
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "jpg";
  if (body.subarray(0, 4).toString() === "RIFF" && body.subarray(8, 12).toString() === "WEBP") return "webp";
  return null;
}
portalFilesRouter.post("/diagrams", classFirst, express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "3mb" }), async (req, res) => {
  const actor = await portalActor(req);
  const classId = Number(req.query.classId);
  classAllowed(actor, classId);
  const kind = imageKind(req.body);
  check(kind, "Upload a PNG, JPEG or WebP picture (maximum 3 MB).");
  res.json({ fileId: await storeClassFile(req.body, classId, kind) });
});
portalFilesRouter.get("/diagrams/:id", async (req, res) => {
  const actor = await portalActor(req);
  const [file] = await db.select().from(portalFiles).where(eq(portalFiles.id, String(req.params.id)));
  const contentType = file ? diagramContentType(file.objectName) : null;
  check(file && contentType, "Diagram not found.", 404);
  // Whole-school documents (timetable pictures) are never exam diagrams.
  const classId = file.classId;
  check(classId !== null, "Diagram not found.", 404);
  if (actor.role === "admin" || actor.role === "teacher") classAllowed(actor, classId);
  else {
    // Students see a diagram only once it is in a paper they have started.
    const student = studentOnly(actor);
    check(student.classId === file.classId, "Diagram not found.", 404);
    const [attempt] = await db.select({ id: portalAttempts.id }).from(portalAttempts)
      .where(and(eq(portalAttempts.studentId, student.id), sql`${portalAttempts.questions}::text like ${"%" + file.id + "%"}`)).limit(1);
    check(attempt, "Diagram not found.", 404);
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", "inline");
  if (file.objectName.startsWith(CLOUDINARY_PREFIX)) {
    await pipeFromCloudinary(res, downloadUrl(file.objectName.slice(CLOUDINARY_PREFIX.length), "raw", "private", contentType), {
      "Content-Type": contentType, "Cache-Control": "private, max-age=600",
    });
    return;
  }
  await serveObject(req, res, storage, async () => objectFile(file.objectName), { noStore: true });
});
/**
 * Staff (and the exam officer) upload a timetable or an assignment's question sheet: a PDF, or a picture of a
 * timetable. With a class it belongs to that class; without one it is a whole-school document (the office or the exam
 * officer only).
 */
const documentFirst: express.RequestHandler = async (req, _res, next) => {
  try {
    const classId = req.query.classId ? Number(req.query.classId) : null;
    check(classId === null || (Number.isInteger(classId) && classId > 0), "Choose a valid class.");
    if (canPublishExams(req)) return next();
    const actor = await portalActor(req);
    if (classId === null) check(actor.role === "admin", "Only the school office or the exam officer can upload for the whole school.", actor.role === "guest" ? 401 : 403);
    else classAllowed(actor, classId);
    next();
  } catch (error) { next(error); }
};
portalFilesRouter.post("/documents", documentFirst, express.raw({ type: ["application/pdf", "image/png", "image/jpeg", "image/webp"], limit: "15mb" }), async (req, res) => {
  const classId = req.query.classId ? Number(req.query.classId) : null;
  if (classId !== null) { const [c] = await db.select({ id: portalClasses.id }).from(portalClasses).where(eq(portalClasses.id, classId)); check(c, "Class not found.", 404); }
  const pdf = Buffer.isBuffer(req.body) && req.body.length > 5 && req.body.subarray(0, 5).toString() === "%PDF-";
  const image = pdf ? null : imageKind(req.body);
  check(pdf || image, "Upload a PDF, or a PNG, JPEG or WebP picture (up to 15MB).");
  const fileId = await storeClassFile(req.body as Buffer, classId, pdf ? "pdf" : image!, "document");
  res.json({ fileId, fileType: pdf ? "pdf" : "image" });
});

/** Whether a timetable or a published assignment shares this file with the given classes (or the whole school). */
async function sharedWith(fileId: string, classIds: number[]) {
  const timetables = await db.select({ classIds: portalTimetables.classIds }).from(portalTimetables).where(and(eq(portalTimetables.fileId, fileId), eq(portalTimetables.published, true)));
  if (timetables.some((t) => !t.classIds.length || t.classIds.some((id) => classIds.includes(id)))) return "timetable" as const;
  if (!classIds.length) return null;
  const [assignment] = await db.select({ id: portalAssignments.id }).from(portalAssignments)
    .where(and(eq(portalAssignments.fileId, fileId), eq(portalAssignments.published, true), or(...classIds.map((id) => eq(portalAssignments.classId, id))))).limit(1);
  return assignment ? "assignment" as const : null;
}

/** May this person open the file? Staff for their classes (and whole-school files); students and parents when shared. */
async function mayOpen(req: express.Request, actor: PortalActor, file: typeof portalFiles.$inferSelect, picture: boolean): Promise<boolean | null> {
  if (actor.role === "admin" || actor.role === "teacher") {
    if (file.classId === null || actor.role === "admin" || actor.classIds.includes(file.classId)) return true;
    // A timetable another teacher posted for this teacher's class too.
    if (await sharedWith(file.id, actor.classIds)) return true;
    classAllowed(actor, file.classId);
    return true;
  }
  if (actor.role === "student") {
    if (await sharedWith(file.id, [actor.student!.classId])) return true;
    // Otherwise the earlier rules decide: the class's revision notes, or a PDF exam during an attempt.
    return !picture && file.classId === actor.student!.classId ? null : false;
  }
  // A parent: the classes of the children linked to their verified email.
  const email = await parentEmail(req);
  if (!email) return false;
  const kids = await db.select({ classId: portalStudents.classId }).from(portalStudents)
    .where(and(eq(portalStudents.active, true), or(sql`lower(trim(${portalStudents.guardianEmail})) = ${email}`, sql`lower(trim(${portalStudents.secondGuardianEmail})) = ${email}`)));
  // Someone with no child at the school sees nothing, not even whole-school timetables.
  return kids.length > 0 && !!(await sharedWith(file.id, [...new Set(kids.map((k) => k.classId))]));
}

portalFilesRouter.get("/files/:id", async (req, res) => {
  const [file] = await db.select().from(portalFiles).where(eq(portalFiles.id, String(req.params.id)));
  check(file, "Document not found.", 404);
  // Exam diagrams are served by /diagrams; only pictures uploaded as documents (timetables) are served here.
  const picture = diagramContentType(file.objectName);
  check(!picture || /(^|\/)doc-|nwe\/portal\/files\//.test(file.objectName), "Document not found.", 404);
  // The exam officer opens whole-school documents and every timetable; otherwise the usual rules apply.
  const officerFile = canPublishExams(req) && (file.classId === null || !!(await db.select({ id: portalTimetables.id }).from(portalTimetables).where(eq(portalTimetables.fileId, file.id)).limit(1))[0]);
  const actor = officerFile ? null : await portalActor(req);
  const allowed = actor ? await mayOpen(req, actor, file, !!picture) : true;
  if (allowed === false) check(false, "Document not found.", 404);
  if (allowed === null) {
    const student = studentOnly(actor!);
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
  const type = picture ?? "application/pdf";
  res.setHeader("Content-Disposition", `inline; filename="school-document.${picture ? picture.split("/")[1].replace("jpeg", "jpg") : "pdf"}"`);
  if (file.objectName.startsWith(CLOUDINARY_PREFIX)) {
    await pipeFromCloudinary(res, downloadUrl(file.objectName.slice(CLOUDINARY_PREFIX.length), "raw", "private", type), {
      "Content-Type": type, "Cache-Control": "private, no-store",
    });
    return;
  }
  await serveObject(req, res, storage, async () => objectFile(file.objectName), { noStore: true });
});
