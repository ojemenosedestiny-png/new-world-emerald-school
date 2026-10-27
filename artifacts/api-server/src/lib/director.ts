import { SCHOOL_TIME_ZONE, addDays, schoolDate } from "./learning";

/** Weekly figures for the Director, as returned by /api/director/overview and sent in the Monday email. */
export interface DirectorReport {
  from: string;
  to: string;
  generatedAt: string;
  admissions: { newThisWeek: number; awaitingReview: number; total: number };
  students: { active: number; pendingActivation: number; activatedThisWeek: number; byClass: { className: string; students: number }[] };
  staff: { activeTeachers: number };
  attendance: { rate: number | null; recorded: number; absentToday: number; byClass: { className: string; rate: number | null; recorded: number }[] };
  learning: { examsHeld: number; attemptsSubmitted: number; averageScore: number | null; assignmentsSet: number; submissions: number };
  money: { confirmedKobo: number; confirmedCount: number; awaitingKobo: number; awaitingCount: number; storeOrders: number; storeOrdersKobo: number };
  messages: { thisWeek: number; unanswered: number };
  website: { liveUpdates: number };
  security: { failedSignIns: number; deniedActions: number };
  highlights: string[];
}

/** Percent rounded to a whole number, or null when there is nothing to divide by. */
export const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

export const naira = (kobo: number) => `NGN ${(kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** The plain-English points at the top of the dashboard and email: what needs the Director's attention first. */
export function highlights(r: Omit<DirectorReport, "highlights">): string[] {
  const out: string[] = [];
  if (r.admissions.awaitingReview) out.push(`${plural(r.admissions.awaitingReview, "admission application")} waiting for review (${r.admissions.newThisWeek} new this week).`);
  if (r.money.awaitingCount) out.push(`${plural(r.money.awaitingCount, "fee payment")} (${naira(r.money.awaitingKobo)}) waiting for the office to confirm.`);
  if (r.money.confirmedCount) out.push(`${naira(r.money.confirmedKobo)} in fees confirmed this week from ${plural(r.money.confirmedCount, "payment")}.`);
  if (r.attendance.rate !== null) {
    const low = r.attendance.byClass.filter((c) => c.rate !== null && c.rate < 85).map((c) => c.className);
    out.push(`Attendance was ${r.attendance.rate}% this week${low.length ? `; below 85% in ${low.join(", ")}` : ""}.`);
  } else out.push("No attendance registers were taken this week.");
  const noRegister = r.attendance.byClass.filter((c) => c.recorded === 0).map((c) => c.className);
  if (r.attendance.rate !== null && noRegister.length) out.push(`No register taken this week for ${noRegister.join(", ")}.`);
  if (r.messages.unanswered) out.push(`${plural(r.messages.unanswered, "student conversation")} waiting for a reply from staff.`);
  if (r.students.pendingActivation) out.push(`${plural(r.students.pendingActivation, "student account")} not yet activated by parents.`);
  if (r.security.failedSignIns >= 20) out.push(`${r.security.failedSignIns} failed student sign-ins this week. Worth a look in Sessions.`);
  return out;
}

/** The week a Monday report covers: the seven school days before `now`, as Lagos dates and exact instants. */
export function reportWindow(now = new Date()) {
  const toDate = schoolDate(now);
  const fromDate = addDays(toDate, -6);
  return { fromDate, toDate, from: new Date(now.getTime() - 7 * 86_400_000), to: now };
}

/** The Lagos date of this week's Monday, used to send the weekly report once. */
export function mondayOf(now = new Date()) {
  const date = schoolDate(now);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

/** True from 07:00 on Monday, Lagos time: when the weekly report is due. */
export function weeklyReportDue(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: SCHOOL_TIME_ZONE, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return weekday === "Mon" && hour >= 7;
}
