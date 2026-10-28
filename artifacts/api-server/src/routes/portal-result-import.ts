import express, { Router, type Request } from "express";
import { desc, sql } from "drizzle-orm";
import {
  db, portalClasses, portalReportCards, portalReportReleases, portalReportWorkflow, portalResultImports, portalScores, portalStudents,
  portalSubjects, portalTerms, type PortalResultImportRecord,
} from "@workspace/db";
import { CommitResultImportQueryParams, PreviewResultImportQueryParams } from "@workspace/api-zod";
import { check, portalActor } from "../lib/portal-auth";
import { checkRows, classKey, rowsFromCsv, templateCsv, type CheckedRow, type Lookups } from "../lib/result-import";

export const portalResultImportRouter = Router();

const MAX_ROWS = 50_000;
const sqlExcluded = (column: string) => sql.raw(`excluded.${column}`);
async function officeOnly(req: Request) {
  const actor = await portalActor(req);
  check(actor.role === "admin", actor.role === "guest" ? "Sign in as an administrator." : "Only the school office can import old results.", actor.role === "guest" ? 401 : 403);
  return actor;
}
// Authorize before reading up to 10 MB of CSV into memory.
const officeFirst: express.RequestHandler = async (req, _res, next) => { try { await officeOnly(req); next(); } catch (e) { next(e); } };
const csvBody = express.text({ type: ["text/csv", "text/plain"], limit: "10mb" });
/** The generated client sends the file as a JSON string; a plain upload sends it as is. */
function csvText(body: unknown) {
  check(typeof body === "string" && body.trim(), "Upload a CSV file. In Excel, use File > Save As > CSV UTF-8.");
  const text = body as string;
  if (text.startsWith('"') && text.endsWith('"')) { try { const parsed = JSON.parse(text); if (typeof parsed === "string") return parsed; } catch { /* a CSV that starts with a quote */ } }
  return text;
}

async function lookups(): Promise<Lookups> {
  const [students, classes, terms, subjects, workflows, releases] = await Promise.all([
    db.select({ id: portalStudents.id, studentId: portalStudents.studentId, name: portalStudents.name }).from(portalStudents),
    db.select().from(portalClasses), db.select().from(portalTerms), db.select().from(portalSubjects),
    db.select().from(portalReportWorkflow), db.select().from(portalReportReleases),
  ]);
  const locked = new Map<string, string>();
  for (const w of workflows) if (w.status !== "draft") locked.set(`${w.termId}|${w.classId}`, w.status === "review" ? "waiting for approval" : w.status);
  for (const r of releases) locked.set(`${r.termId}|${r.classId}`, "published");
  return {
    students: new Map(students.map((s) => [s.studentId.toUpperCase().replace(/\s+/g, ""), { id: s.id, name: s.name }])),
    classes: new Map(classes.map((c) => [classKey(c.name), { id: c.id, name: c.name }])),
    terms: new Map(terms.map((t) => [`${t.session}|${t.term}`, { id: t.id, caMax: t.caMax, examMax: t.examMax }])),
    subjects: new Map(subjects.map((s) => [`${s.classId}|${s.name.toLowerCase()}`, s.id])),
    existingScores: new Set((await db.select({ termId: portalScores.termId, studentId: portalScores.studentId, subjectId: portalScores.subjectId }).from(portalScores)).map((s) => `${s.termId}|${s.studentId}|${s.subjectId}`)),
    locked,
  };
}

async function checkFile(req: Request, maxima: { caMax?: number; examMax?: number }) {
  const { rows, missing } = rowsFromCsv(csvText(req.body));
  check(rows.length <= MAX_ROWS, `This file has ${rows.length} rows. Split it into files of up to ${MAX_ROWS} rows, for example one per session.`);
  const newTermMaxima = { caMax: maxima.caMax ?? 40, examMax: maxima.examMax ?? 60 };
  const checked = missing.length ? [] : checkRows(rows, await lookups(), newTermMaxima);
  return { rows, missing, checked, newTermMaxima };
}

function summarise(checked: CheckedRow[]) {
  const good = checked.filter((r) => r.status !== "error");
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  const pull = (prefix: RegExp) => uniq(good.flatMap((r) => r.messages.filter((m) => prefix.test(m)).map((m) => m.replace(prefix, "").replace(/ will be created/, "").replace(/ will be added to /, " in ").replace(/\.$/, "").trim())));
  return {
    terms: uniq(good.map((r) => `${r.term}, ${r.session}`)), classes: uniq(good.map((r) => r.className)),
    newTerms: pull(/^New term /), newSubjects: pull(/^New subject /),
  };
}

portalResultImportRouter.get("/results-import/template", async (req, res) => {
  await officeOnly(req);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="old-results-template.csv"');
  res.send("﻿" + templateCsv());
});

const view = (r: PortalResultImportRecord) => ({
  id: r.id, fileName: r.fileName, importedBy: r.importedBy, rows: r.rows, imported: r.imported, skipped: r.skipped, warnings: r.warnings, published: r.published,
  ...r.summary, createdAt: r.createdAt.toISOString(),
});

portalResultImportRouter.get("/results-import/history", async (req, res) => {
  await officeOnly(req);
  res.json((await db.select().from(portalResultImports).orderBy(desc(portalResultImports.createdAt), desc(portalResultImports.id)).limit(100)).map(view));
});

portalResultImportRouter.post("/results-import/preview", officeFirst, csvBody, async (req, res) => {
  const { checked, missing } = await checkFile(req, PreviewResultImportQueryParams.parse(req.query));
  const pick = (r: CheckedRow) => ({ line: r.line, status: r.status, messages: r.messages, studentId: r.studentId, studentName: r.studentName, className: r.className, session: r.session, term: r.term, subject: r.subject, ca: r.ca, exam: r.exam, total: r.total, grade: r.grade });
  const good = checked.filter((r) => r.status !== "error");
  res.json({
    missingColumns: missing, total: checked.length,
    ok: checked.filter((r) => r.status === "ok").length, warnings: checked.filter((r) => r.status === "warning").length, errors: checked.filter((r) => r.status === "error").length,
    students: new Set(good.map((r) => r.studentDbId)).size, ...summarise(checked),
    problems: checked.filter((r) => r.status !== "ok").sort((a, b) => (a.status === b.status ? a.line - b.line : a.status === "error" ? -1 : 1)).slice(0, 500).map(pick),
    sample: checked.filter((r) => r.status === "ok").slice(0, 20).map(pick),
  });
});

portalResultImportRouter.post("/results-import/commit", officeFirst, csvBody, async (req, res) => {
  const actor = await officeOnly(req);
  const query = CommitResultImportQueryParams.parse(req.query);
  const publish = req.query.publish === "true";
  const { checked, missing, newTermMaxima } = await checkFile(req, query);
  check(!missing.length, `The file is missing these columns: ${missing.join(", ")}.`);
  const good = checked.filter((r) => r.status !== "error");
  check(good.length, "No rows can be imported. Fix the errors shown in the preview and upload again.");
  const by = req.identity?.email || actor.name;

  const result = await db.transaction(async (tx) => {
    // Terms and subjects that do not exist yet.
    const termIds = new Map((await tx.select().from(portalTerms)).map((t) => [`${t.session}|${t.term}`, t.id]));
    for (const key of new Set(good.map((r) => `${r.session}|${r.term}`))) {
      if (termIds.has(key)) continue;
      const [session, term] = key.split("|");
      const [created] = await tx.insert(portalTerms).values({ session, term, ...newTermMaxima }).returning();
      termIds.set(key, created.id);
    }
    const subjectIds = new Map((await tx.select().from(portalSubjects)).map((s) => [`${s.classId}|${s.name.toLowerCase()}`, s.id]));
    const order = new Map<number, number>();
    for (const r of good) {
      const key = `${r.classId}|${r.subject.toLowerCase()}`;
      if (subjectIds.has(key)) continue;
      const sortOrder = order.get(r.classId!) ?? [...subjectIds.keys()].filter((k) => k.startsWith(`${r.classId}|`)).length;
      order.set(r.classId!, sortOrder + 1);
      const [created] = await tx.insert(portalSubjects).values({ classId: r.classId!, name: r.subject, sortOrder }).returning();
      subjectIds.set(key, created.id);
    }
    // Scores, in chunks.
    const scores = good.map((r) => ({
      termId: termIds.get(`${r.session}|${r.term}`)!, studentId: r.studentDbId!, subjectId: subjectIds.get(`${r.classId}|${r.subject.toLowerCase()}`)!,
      ca: r.ca, exam: r.exam, total: r.total, grade: r.grade,
    }));
    for (let i = 0; i < scores.length; i += 500) {
      await tx.insert(portalScores).values(scores.slice(i, i + 500)).onConflictDoUpdate({
        target: [portalScores.termId, portalScores.studentId, portalScores.subjectId],
        set: { ca: sqlExcluded("ca"), exam: sqlExcluded("exam"), total: sqlExcluded("total"), grade: sqlExcluded("grade"), updatedAt: new Date() },
      });
    }
    // Comments and attendance: one report card per student and term, from the first row that has them.
    const cards = new Map<string, { termId: number; studentId: number; teacherRemark: string; principalRemark: string; daysPresent: number | null; daysOpen: number | null }>();
    for (const r of good) {
      const termId = termIds.get(`${r.session}|${r.term}`)!;
      const key = `${termId}|${r.studentDbId}`;
      const c = cards.get(key) ?? { termId, studentId: r.studentDbId!, teacherRemark: "", principalRemark: "", daysPresent: null, daysOpen: null };
      c.teacherRemark ||= r.teacherRemark; c.principalRemark ||= r.principalRemark;
      c.daysPresent ??= r.daysPresent; c.daysOpen ??= r.daysOpen;
      cards.set(key, c);
    }
    for (const c of cards.values()) {
      if (!c.teacherRemark && !c.principalRemark && c.daysPresent === null && c.daysOpen === null) continue;
      await tx.insert(portalReportCards).values(c).onConflictDoUpdate({ target: [portalReportCards.termId, portalReportCards.studentId], set: { teacherRemark: c.teacherRemark, principalRemark: c.principalRemark, daysPresent: c.daysPresent, daysOpen: c.daysOpen } });
    }
    // Imported results keep their own totals and grades (manual mode), and are published if asked.
    const pairs = new Map<string, { termId: number; classId: number }>();
    for (const s of good) { const termId = termIds.get(`${s.session}|${s.term}`)!; pairs.set(`${termId}|${s.classId}`, { termId, classId: s.classId! }); }
    for (const p of pairs.values()) {
      const values = publish ? { mode: "manual", status: "approved", approvedBy: `${by} (imported)`, approvedAt: new Date(), updatedAt: new Date() } : { mode: "manual", updatedAt: new Date() };
      await tx.insert(portalReportWorkflow).values({ ...p, ...values }).onConflictDoUpdate({ target: [portalReportWorkflow.termId, portalReportWorkflow.classId], set: values });
      if (publish) await tx.insert(portalReportReleases).values(p).onConflictDoNothing();
    }
    const fileName = (query.fileName ?? "").slice(0, 200);
    const [log] = await tx.insert(portalResultImports).values({
      fileName, importedBy: by, rows: checked.length, imported: good.length, skipped: checked.length - good.length,
      warnings: good.filter((r) => r.status === "warning").length, published: publish ? pairs.size : 0, summary: summarise(checked),
    }).returning();
    return log;
  });
  res.json(view(result));
});
