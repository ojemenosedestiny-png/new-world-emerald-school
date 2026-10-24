import type { PortalDashboard, PortalEvent, StudentReports } from "@workspace/api-client-react";
import { examWindow } from "./lib";
import type { StudentSection } from "./StudentHome";

export type PortalNotice = { key: string; kind: "exam" | "notice" | "result" | "report" | "event"; title: string; detail: string; section: StudentSection; unseen: boolean };
type Seen = Record<string, true>;

const storageKey = (studentId: string) => "nwe-seen:" + studentId;
export function readSeen(studentId: string): Seen {
  try { return JSON.parse(localStorage.getItem(storageKey(studentId)) ?? "{}") as Seen; } catch { return {}; }
}
export function markSeen(studentId: string, keys: string[]) {
  const seen = readSeen(studentId);
  for (const k of keys) seen[k] = true;
  try { localStorage.setItem(storageKey(studentId), JSON.stringify(seen)); } catch { /* storage unavailable */ }
}

/** Everything worth a student's attention, newest-relevant first; `unseen` drives the bell badge. */
export function studentNotifications(data: PortalDashboard, reports: StudentReports | undefined, seen: Seen, now = Date.now(), events: PortalEvent[] = []): PortalNotice[] {
  const attempted = new Map(data.attempts.map((a) => [a.examId, a]));
  const list: PortalNotice[] = [];
  for (const e of data.exams) {
    const a = attempted.get(e.id);
    if (examWindow(e.startsAt, e.endsAt, now) === "open" && (!a || a.status === "in_progress")) {
      const key = "exam:" + e.id;
      list.push({ key, kind: "exam", title: a ? `Finish ${e.title}` : `${e.title} is open`, detail: `${e.subject} / ${e.durationMinutes} min`, section: "exams", unseen: !seen[key] });
    }
  }
  for (const a of data.attempts) {
    if (a.status === "marked" && a.resultsReleased && typeof a.score === "number") {
      const key = "result:" + a.id;
      list.push({ key, kind: "result", title: `Result released: ${a.title}`, detail: `${a.score} / ${a.totalMarks}`, section: "results", unseen: !seen[key] });
    }
  }
  for (const r of reports?.reports ?? []) {
    const key = "report:" + r.term.id;
    list.push({ key, kind: "report", title: `Report card: ${r.term.term}`, detail: `${r.term.session} session`, section: "reports", unseen: !seen[key] });
  }
  for (const n of [...data.notices].reverse()) {
    const key = "notice:" + n.id;
    list.push({ key, kind: "notice", title: n.title, detail: n.body.slice(0, 90), section: "notices", unseen: !seen[key] });
  }
  // Events in the next two weeks.
  for (const e of events) {
    const start = new Date(e.startsAt).getTime();
    if (start < now - 86_400_000 || start > now + 14 * 86_400_000) continue;
    const key = "event:" + e.id;
    const when = new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short" }).format(new Date(start));
    list.push({ key, kind: "event", title: e.title, detail: [when, e.venue].filter(Boolean).join(" / "), section: "events", unseen: !seen[key] });
  }
  return list.sort((x, y) => Number(y.unseen) - Number(x.unseen));
}

export type SearchHit = { key: string; label: string; detail: string; section: StudentSection };

/** Searches features and the student's own exams, notices, notes and results. */
export function searchPortal(query: string, data: PortalDashboard, features: { label: string; detail: string; section: StudentSection }[], events: PortalEvent[] = []): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const has = (...parts: (string | null | undefined)[]) => parts.some((p) => p?.toLowerCase().includes(q));
  const hits: SearchHit[] = [];
  for (const f of features) if (has(f.label, f.detail)) hits.push({ key: "f:" + f.section + f.label, label: f.label, detail: f.detail, section: f.section });
  for (const e of data.exams) if (has(e.title, e.subject)) hits.push({ key: "e:" + e.id, label: e.title, detail: `Exam / ${e.subject}`, section: "exams" });
  for (const n of data.notices) if (has(n.title, n.body)) hits.push({ key: "n:" + n.id, label: n.title, detail: "Notice", section: "notices" });
  for (const m of data.materials) if (has(m.title, m.subject, m.body)) hits.push({ key: "m:" + m.id, label: m.title, detail: `Library / ${m.subject}`, section: "revision" });
  for (const a of data.attempts) if (a.status !== "in_progress" && has(a.title, a.subject)) hits.push({ key: "a:" + a.id, label: a.title, detail: "Result", section: "results" });
  for (const e of events) if (has(e.title, e.venue, e.details)) hits.push({ key: "ev:" + e.id, label: e.title, detail: "Event", section: "events" });
  return hits.slice(0, 12);
}
