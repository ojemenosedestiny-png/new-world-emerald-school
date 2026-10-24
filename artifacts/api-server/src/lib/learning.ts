// Attendance and assignment rules, kept free of the database so they can be unit tested.

export const ATTENDANCE_STATUSES = ["present", "late", "absent", "excused"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
const SCHOOL_TIME_ZONE = "Africa/Lagos";

/** The school's calendar date (YYYY-MM-DD) for a moment, in Lagos time. */
export function schoolDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Shifts a YYYY-MM-DD date by whole days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type Totals = { present: number; late: number; absent: number; excused: number; daysPresent: number; daysRecorded: number };

/** Counts a student's register entries; late still counts as present for "days present". */
export function tally(statuses: string[]): Totals {
  const t: Totals = { present: 0, late: 0, absent: 0, excused: 0, daysPresent: 0, daysRecorded: 0 };
  for (const s of statuses) {
    if (!(ATTENDANCE_STATUSES as readonly string[]).includes(s)) continue;
    t[s as AttendanceStatus]++;
    t.daysRecorded++;
  }
  t.daysPresent = t.present + t.late;
  return t;
}

export const isLate = (submittedAt: Date, dueAt: Date) => submittedAt.getTime() > dueAt.getTime();

/** Validates assignment input; returns an error message or clean values. */
export function assignmentValues(input: { subject: string; title: string; instructions?: string | undefined; dueAt: string; maxScore: number; published: boolean }) {
  const subject = input.subject.trim(), title = input.title.trim();
  if (!subject || !title) return { ok: false as const, error: "Add a subject and a title." };
  const dueAt = new Date(input.dueAt);
  if (Number.isNaN(dueAt.getTime())) return { ok: false as const, error: "Choose a valid due date." };
  return { ok: true as const, values: { subject, title, instructions: (input.instructions ?? "").trim(), dueAt, maxScore: input.maxScore, published: input.published } };
}
