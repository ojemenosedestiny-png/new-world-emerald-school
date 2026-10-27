import type { PortalManagement } from "@workspace/api-client-react";
import { examWindow } from "../lib";

const DAY = 86_400_000;
const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

export type ExamAverage = { id: number; title: string; className: string; average: number; marked: number };
export type DayCount = { label: string; date: string; count: number };
export type ClassCount = { name: string; students: number };
export type Attention = { kind: "mark" | "release" | "live"; examId: number; title: string; count: number };
/** An exam open right now, as a teacher watching the room sees it. The four counts add up to the class size. */
export type LiveExam = { id: number; title: string; subject: string; className: string; endsAt: string; classSize: number; notStarted: number; writing: number; submitted: number; timedOut: number };

export function dashboardData(data: PortalManagement, now = Date.now()) {
  const className = (id: number) => data.classes.find((c) => c.id === id)?.name ?? "Class";

  // Average % of marked attempts per exam, most recent eight exams that have any marked work.
  const examAverages: ExamAverage[] = data.exams
    .map((e) => {
      const marked = data.attempts.filter((a) => a.examId === e.id && a.status === "marked" && typeof a.score === "number" && a.totalMarks > 0);
      const average = marked.length ? Math.round((marked.reduce((s, a) => s + (a.score! / a.totalMarks) * 100, 0) / marked.length) * 10) / 10 : null;
      return { id: e.id as number, title: e.title, className: className(e.classId), average, marked: marked.length, endsAt: new Date(e.endsAt).getTime() };
    })
    .filter((e): e is ExamAverage & { endsAt: number; average: number } => e.average !== null)
    .sort((a, b) => a.endsAt - b.endsAt)
    .slice(-8)
    .map(({ endsAt: _e, ...rest }) => rest);

  // Submitted attempts per day over the last 14 days (today included).
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const days: DayCount[] = Array.from({ length: 14 }, (_, i) => {
    const t = start.getTime() - (13 - i) * DAY;
    return { date: dayKey(t), label: new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short" }).format(t), count: 0 };
  });
  const index = new Map(days.map((d, i) => [d.date, i]));
  for (const a of data.attempts) {
    if (a.status === "in_progress") continue;
    const i = index.get(dayKey(new Date(a.savedAt).getTime()));
    if (i !== undefined) days[i].count++;
  }

  const studentsByClass: ClassCount[] = data.classes
    .map((c) => ({ name: c.name, students: data.students.filter((s) => s.classId === c.id && s.active).length }))
    .sort((a, b) => b.students - a.students);

  const attention: Attention[] = [];
  for (const e of data.exams) {
    const attempts = data.attempts.filter((a) => a.examId === e.id);
    const toMark = attempts.filter((a) => a.status === "submitted").length;
    const writing = attempts.filter((a) => a.status === "in_progress" && new Date(a.deadline).getTime() > now).length;
    const closed = new Date(e.endsAt).getTime() <= now;
    if (writing) attention.push({ kind: "live", examId: e.id as number, title: e.title, count: writing });
    if (toMark) attention.push({ kind: "mark", examId: e.id as number, title: e.title, count: toMark });
    else if (closed && !e.resultsReleased && attempts.length && attempts.every((a) => a.status === "marked")) attention.push({ kind: "release", examId: e.id as number, title: e.title, count: attempts.length });
  }
  const order = { live: 0, mark: 1, release: 2 };
  attention.sort((a, b) => order[a.kind] - order[b.kind]);

  const upcoming = data.exams
    .filter((e) => e.published && examWindow(e.startsAt, e.endsAt, now) !== "closed")
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .slice(0, 5)
    .map((e) => ({ id: e.id as number, title: e.title, subject: e.subject, className: className(e.classId), startsAt: e.startsAt, open: examWindow(e.startsAt, e.endsAt, now) === "open" }));

  // Open exams: everyone in the class is not started, writing, submitted, or out of time without submitting.
  const live: LiveExam[] = data.exams
    .filter((e) => e.published && examWindow(e.startsAt, e.endsAt, now) === "open")
    .map((e) => {
      const attempts = data.attempts.filter((a) => a.examId === e.id);
      const writing = attempts.filter((a) => a.status === "in_progress" && new Date(a.deadline).getTime() > now).length;
      const timedOut = attempts.filter((a) => a.status === "in_progress" && new Date(a.deadline).getTime() <= now).length;
      const submitted = attempts.filter((a) => a.status !== "in_progress").length;
      const classSize = Math.max(data.students.filter((s) => s.classId === e.classId && s.active).length, attempts.length);
      return { id: e.id as number, title: e.title, subject: e.subject, className: className(e.classId), endsAt: e.endsAt, classSize, writing, timedOut, submitted, notStarted: classSize - writing - timedOut - submitted };
    })
    .sort((a, b) => a.endsAt.localeCompare(b.endsAt));

  return { examAverages, days, studentsByClass, attention, upcoming, live };
}
