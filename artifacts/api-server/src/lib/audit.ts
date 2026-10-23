import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import {
  db, portalAuditLog, portalStudents, portalTeachers, portalClasses, portalExams, portalAttempts, portalMaterials, portalNotices,
  portalTerms, portalSubjects,
} from "@workspace/db";
import { logger } from "./logger";
import { clientIp, sanitizeForAudit } from "./audit-format";

export { clientIp, sanitizeForAudit };

export type AuditEntry = {
  actorKind: "staff" | "student" | "system"; actorId?: string | null; actorLabel?: string; action: string;
  targetType?: string | null; targetId?: string | number | null; outcome?: "success" | "denied" | "failed";
  status?: number; before?: unknown; after?: unknown; ip?: string | null; userAgent?: string | null;
};

/** Writes one audit row. Never throws: a logging failure must not fail the action itself. */
export async function recordAudit(entry: AuditEntry) {
  try {
    await db.insert(portalAuditLog).values({
      actorKind: entry.actorKind, actorId: entry.actorId ?? null, actorLabel: entry.actorLabel ?? "", action: entry.action.slice(0, 120),
      targetType: entry.targetType ?? null, targetId: entry.targetId === undefined || entry.targetId === null ? null : String(entry.targetId),
      outcome: entry.outcome ?? "success", status: entry.status ?? null, ip: entry.ip ?? null, userAgent: entry.userAgent?.slice(0, 300) ?? null,
      before: entry.before === undefined ? null : sanitizeForAudit(entry.before), after: entry.after === undefined ? null : sanitizeForAudit(entry.after),
    });
  } catch (error) {
    logger.error({ err: error, action: entry.action }, "Audit log write failed");
  }
}

type Body = Record<string, unknown> & { action?: string };
const pick = (b: Body, key: string) => (b[key] && typeof b[key] === "object" ? b[key] as Record<string, unknown> : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : undefined);

/** Which record a portal command changes, and how to read its current state for "before". */
export function commandTarget(body: Body): { type: string; id?: number; load?: () => Promise<unknown> } | null {
  const one = async <T>(rows: Promise<T[]>) => (await rows)[0] ?? null;
  switch (body.action) {
    case "saveStudent": { const id = num(pick(body, "student")?.id); return { type: "student", id, load: id ? () => one(db.select({ id: portalStudents.id, studentId: portalStudents.studentId, name: portalStudents.name, classId: portalStudents.classId, active: portalStudents.active }).from(portalStudents).where(eq(portalStudents.id, id))) : undefined }; }
    case "saveTeacher": { const id = num(pick(body, "teacher")?.id); return { type: "teacher", id, load: id ? () => one(db.select().from(portalTeachers).where(eq(portalTeachers.id, id))) : undefined }; }
    case "saveClass": { const id = num(pick(body, "schoolClass")?.id); return { type: "class", id, load: id ? () => one(db.select().from(portalClasses).where(eq(portalClasses.id, id))) : undefined }; }
    case "saveExam": case "examStatus": case "deleteExam": {
      const id = num(pick(body, body.action === "saveExam" ? "exam" : body.action === "examStatus" ? "examStatus" : "target")?.id);
      return { type: "exam", id, load: id ? () => one(db.select({ id: portalExams.id, title: portalExams.title, classId: portalExams.classId, startsAt: portalExams.startsAt, endsAt: portalExams.endsAt, durationMinutes: portalExams.durationMinutes, published: portalExams.published, resultsReleased: portalExams.resultsReleased, questionCount: portalExams.questions }).from(portalExams).where(eq(portalExams.id, id))).then((r) => r && { ...r, questionCount: Array.isArray(r.questionCount) ? r.questionCount.length : 0 }) : undefined };
    }
    case "grade": case "extendAttempt": case "resetAttempt": {
      const id = num(pick(body, body.action === "grade" ? "grade" : "attemptControl")?.attemptId);
      return { type: "attempt", id, load: id ? () => one(db.select({ id: portalAttempts.id, examId: portalAttempts.examId, studentId: portalAttempts.studentId, status: portalAttempts.status, deadline: portalAttempts.deadline, marks: portalAttempts.marks }).from(portalAttempts).where(eq(portalAttempts.id, id))) : undefined };
    }
    case "saveMaterial": case "deleteMaterial": { const id = num(pick(body, body.action === "saveMaterial" ? "material" : "target")?.id); return { type: "material", id, load: id ? () => one(db.select().from(portalMaterials).where(eq(portalMaterials.id, id))) : undefined }; }
    case "saveNotice": case "deleteNotice": { const id = num(pick(body, body.action === "saveNotice" ? "notice" : "target")?.id); return { type: "notice", id, load: id ? () => one(db.select().from(portalNotices).where(eq(portalNotices.id, id))) : undefined }; }
    case "saveTerm": case "deleteTerm": { const id = num(pick(body, body.action === "saveTerm" ? "term" : "target")?.id); return { type: "term", id, load: id ? () => one(db.select().from(portalTerms).where(eq(portalTerms.id, id))) : undefined }; }
    case "saveSubject": case "deleteSubject": { const id = num(pick(body, body.action === "saveSubject" ? "subject" : "target")?.id); return { type: "subject", id, load: id ? () => one(db.select().from(portalSubjects).where(eq(portalSubjects.id, id))) : undefined }; }
    case "saveScores": return { type: "scores", id: num(pick(body, "scores")?.termId) };
    case "saveCards": return { type: "report_cards", id: num(pick(body, "cards")?.termId) };
    case "releaseReports": return { type: "report_release", id: num(pick(body, "release")?.termId) };
    default: return null;
  }
}

const COMMAND_PATHS = new Set(["/api/portal/manage", "/api/portal/reports/manage"]);
// Public submissions and high-frequency student writes are not staff actions.
const SKIP = [/^\/api\/portal\/(session|password|attempts|exams\/\d+\/start)/, /^\/api\/csp-report/, /^\/api\/__clerk/];

/**
 * Records every signed-in staff member's change (POST/PUT/PATCH/DELETE) once the response
 * finishes, including refusals. Portal commands also capture the record's prior state.
 */
export function auditStaffChanges() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !req.dbUser) return next();
    const path = req.originalUrl.split("?")[0];
    if (SKIP.some((r) => r.test(path))) return next();
    const body = (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? req.body : {}) as Body;
    const command = COMMAND_PATHS.has(path) ? commandTarget(body) : null;
    let before: unknown;
    if (command?.load) { try { before = await command.load(); } catch { before = undefined; } }
    res.on("finish", () => {
      const status = res.statusCode;
      void recordAudit({
        actorKind: "staff", actorId: req.dbUser?.id ?? null, actorLabel: req.identity?.email ?? "",
        action: command ? `portal.${body.action}` : `${req.method} ${path.replace(/^\/api/, "")}`,
        targetType: command?.type ?? null, targetId: command?.id ?? null,
        outcome: status < 400 ? "success" : status === 401 || status === 403 ? "denied" : "failed", status,
        before, after: Buffer.isBuffer(req.body) ? { bytes: req.body.length } : body,
        ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null,
      });
    });
    next();
  };
}
