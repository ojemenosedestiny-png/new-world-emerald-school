import { Router } from "express";
import { and, asc, count, desc, eq, gte, lte } from "drizzle-orm";
import { db, examRegistrationSettings, examRegistrations, portalAttempts, portalAttendance, portalClasses, portalExams, portalStudents } from "@workspace/db";
import { GetChairmanBoardQueryParams } from "@workspace/api-zod";
import { canViewChairman } from "../lib/website-admin";
import { highlights, percent, reportWindow } from "../lib/director";
import { classSection } from "../lib/principal";
import { buildDirectorReport } from "./director";

/**
 * The Chairman's board: a read-only view of the whole school for the Chairman of the board. It shows numbers only:
 * students, staff, attendance, learning and results. It never shows money and offers nothing to send or change.
 */
const router = Router();
const n = (v: unknown) => Number(v ?? 0);
type Section = "primary" | "secondary" | "other";
// A week, a month, or a term.
const CHAIRMAN_PERIODS = [7, 30, 90];

router.get("/chairman/board", async (req, res) => {
  if (!canViewChairman(req)) { res.status(req.identity ? 403 : 401).json({ error: "This board is for the Chairman only." }); return; }
  res.setHeader("Cache-Control", "no-store");
  const { days: asked } = GetChairmanBoardQueryParams.parse(req.query);
  const days = CHAIRMAN_PERIODS.includes(asked ?? 0) ? asked! : 30;
  const now = new Date();
  const report = await buildDirectorReport(now, days);
  const { from, fromDate, toDate } = reportWindow(now, days);
  const classes = await db.select({ id: portalClasses.id, name: portalClasses.name }).from(portalClasses).orderBy(asc(portalClasses.name));
  const sectionOf = (name: string): Section => classSection(name) ?? "other";

  // Released exam and test results in the period, as a percentage per class.
  const results = await db.select({ classId: portalExams.classId, questions: portalAttempts.questions, marks: portalAttempts.marks }).from(portalAttempts)
    .innerJoin(portalExams, eq(portalExams.id, portalAttempts.examId))
    .where(and(eq(portalAttempts.status, "marked"), eq(portalExams.resultsReleased, true), gte(portalAttempts.savedAt, from)));
  const scoreFor = (ids: number[]) => {
    const rows = results.filter((r) => ids.includes(r.classId));
    return { average: percent(rows.reduce((s, r) => s + r.marks.reduce((t, m) => t + m.score, 0), 0), rows.reduce((s, r) => s + r.questions.reduce((t, q) => t + q.marks, 0), 0)), count: rows.length };
  };
  const register = await db.select({ classId: portalAttendance.classId, date: portalAttendance.date, status: portalAttendance.status, c: count() }).from(portalAttendance)
    .where(and(gte(portalAttendance.date, fromDate), lte(portalAttendance.date, toDate))).groupBy(portalAttendance.classId, portalAttendance.date, portalAttendance.status);
  const rate = (rows: typeof register) => percent(rows.filter((r) => r.status === "present" || r.status === "late").reduce((s, r) => s + n(r.c), 0), rows.reduce((s, r) => s + n(r.c), 0));
  const studentsIn = (id: number) => report.students.byClass.find((c) => c.className === classes.find((x) => x.id === id)?.name)?.students ?? 0;

  const classRows = classes.map((c) => {
    const att = register.filter((r) => r.classId === c.id);
    const sc = scoreFor([c.id]);
    return { className: c.name, section: sectionOf(c.name), students: studentsIn(c.id), attendanceRate: rate(att), recorded: att.reduce((s, r) => s + n(r.c), 0), averageScore: sc.average, results: sc.count };
  });
  const sections = (["secondary", "primary", "other"] as const).map((section) => {
    const ids = classes.filter((c) => sectionOf(c.name) === section).map((c) => c.id);
    return { section, students: ids.reduce((s, id) => s + studentsIn(id), 0), classes: ids.length, attendanceRate: rate(register.filter((r) => ids.includes(r.classId))), averageScore: scoreFor(ids).average };
  }).filter((s) => s.classes > 0);
  const dates = [...new Set(register.map((r) => r.date))].sort().slice(-20);
  const attendanceTrend = dates.map((date) => { const rows = register.filter((r) => r.date === date); return { date, rate: rate(rows), recorded: rows.reduce((s, r) => s + n(r.c), 0) }; });

  // WAEC/NECO progress for the newest session: candidates and forms submitted (no fee figures).
  const [waecSettings] = await db.select().from(examRegistrationSettings).orderBy(desc(examRegistrationSettings.academicYear)).limit(1);
  let waec = null;
  if (waecSettings) {
    const candidates = waecSettings.classIds.length ? (await Promise.all(waecSettings.classIds.map(async (id) => n((await db.select({ c: count() }).from(portalStudents).where(and(eq(portalStudents.classId, id), eq(portalStudents.active, true))))[0]?.c)))).reduce((a, b) => a + b, 0) : 0;
    const [sub] = await db.select({ c: count() }).from(examRegistrations).where(and(eq(examRegistrations.academicYear, waecSettings.academicYear), eq(examRegistrations.status, "submitted")));
    waec = { academicYear: waecSettings.academicYear, open: waecSettings.open, candidates, submitted: n(sub?.c) };
  }

  const noMoney = { ...report, money: { confirmedKobo: 0, confirmedCount: 0, awaitingKobo: 0, awaitingCount: 0, storeOrders: 0, storeOrdersKobo: 0 } };
  res.json({
    days, from: report.from, to: report.to, generatedAt: report.generatedAt,
    totals: { students: report.students.active, teachers: report.staff.activeTeachers, classes: classes.length, attendanceRate: report.attendance.rate, absentToday: report.attendance.absentToday, averageScore: scoreFor(classes.map((c) => c.id)).average },
    sections, classes: classRows, attendanceTrend,
    learning: [
      { label: "Exams and tests held", value: report.learning.examsHeld }, { label: "Papers written", value: report.learning.attemptsSubmitted },
      { label: "Homework set", value: report.learning.assignmentsSet }, { label: "Homework handed in", value: report.learning.submissions },
    ],
    admissions: [
      { label: "New applications", value: report.admissions.newThisWeek }, { label: "Waiting for review", value: report.admissions.awaitingReview },
      { label: "Students still to activate their account", value: report.students.pendingActivation },
    ],
    // Money is left out of the Chairman's highlights.
    highlights: highlights(noMoney).filter((h) => !/₦|NGN|fee|payment|order/i.test(h)),
    waec,
  });
});

export default router;
