import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { ApiError, getGetPortalDashboardQueryKey, getGetMyPhotoQueryKey, getGetStaffDirectoryQueryKey, getGetStudentReportsQueryKey, getListPortalAlbumsQueryKey, getListPortalEventsQueryKey } from "@workspace/api-client-react";

export const DRAFT_PREFIX = "nwe-portal-draft:";

export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof ApiError) {
    const data = error.data as { error?: string; message?: string } | null;
    if (data && typeof data === "object") {
      if (typeof data.error === "string" && data.error) return data.error;
      if (typeof data.message === "string" && data.message) return data.message;
    }
    if (error.status === 401) return "Your session has ended. Please sign in again.";
    if (error.status === 403) return "You do not have permission for this action.";
    if (error.status >= 500) return "The school server could not complete this request. Please try again shortly.";
  }
  if (error instanceof TypeError) return "No connection to the school server. Check your internet and try again.";
  return error instanceof Error && error.message ? error.message : fallback;
}

export function isNetworkError(error: unknown) {
  return error instanceof TypeError || (error instanceof ApiError && error.status >= 500);
}

export function fileUrl(fileId: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return base + "/api/portal/files/" + encodeURIComponent(fileId);
}

export function diagramUrl(fileId: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return base + "/api/portal/diagrams/" + encodeURIComponent(fileId);
}

/** Remove every cached query that belongs to a student identity. */
export async function clearStudentQueries(queryClient: QueryClient) {
  // Preserve the active session observer. Removing it and recreating its cache
  // entry leaves the mounted login screen attached to a discarded query.
  await queryClient.cancelQueries({
    predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/portal"),
  });
  queryClient.removeQueries({ queryKey: getGetPortalDashboardQueryKey() });
  queryClient.removeQueries({ queryKey: getGetStudentReportsQueryKey() });
  queryClient.removeQueries({ queryKey: getListPortalEventsQueryKey() });
  queryClient.removeQueries({ queryKey: getGetStaffDirectoryQueryKey() });
  queryClient.removeQueries({ queryKey: getListPortalAlbumsQueryKey() });
  queryClient.removeQueries({ queryKey: getGetMyPhotoQueryKey() });
  queryClient.removeQueries({
    predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/portal/attempts"),
  });
}

export function clearDrafts(exceptStudentId?: string) {
  try {
    const remove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DRAFT_PREFIX)) continue;
      if (exceptStudentId && key.startsWith(DRAFT_PREFIX + exceptStudentId + ":")) continue;
      remove.push(key);
    }
    remove.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage unavailable */
  }
}

export function usePortalMeta(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = title + " | New World Emerald";
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.title = previous;
      meta.remove();
    };
  }, [title]);
}

export function formatDateTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Date not set";
  return new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(d);
}

type Timed = { startsAt: string; endsAt: string };
export type ExamGroupKey = "open" | "upcoming" | "finished";
const GROUP_LABEL: Record<ExamGroupKey, string> = { open: "Open now", upcoming: "Coming up", finished: "Finished" };
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "Today", "Tomorrow", "Yesterday" or "Tuesday 24 November" (with the year when it is not this year). */
export function dayHeading(value: string, now = Date.now()) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Date not set";
  const today = new Date(now);
  const shift = (n: number) => dayOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n));
  const near = ({ [shift(0)]: "Today", [shift(1)]: "Tomorrow", [shift(-1)]: "Yesterday" } as Record<string, string>)[dayOf(d)];
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-NG", o).format(d);
  const full = [part({ weekday: "long" }), d.getDate(), part({ month: "long" }), ...(d.getFullYear() !== today.getFullYear() ? [d.getFullYear()] : [])].join(" ");
  return near ? `${near}, ${full}` : full;
}

/**
 * Exams in date and time order: open now (closing soonest first), coming up (soonest first), then finished (most
 * recent first), each grouped by the day it opens.
 */
export function examTimeline<T extends Timed>(exams: T[], now = Date.now()) {
  const at = (v: string) => new Date(v).getTime() || 0;
  const by: Record<ExamGroupKey, T[]> = { open: [], upcoming: [], finished: [] };
  for (const e of exams) { const w = examWindow(e.startsAt, e.endsAt, now); by[w === "open" ? "open" : w === "upcoming" ? "upcoming" : "finished"].push(e); }
  by.open.sort((a, b) => at(a.endsAt) - at(b.endsAt) || at(a.startsAt) - at(b.startsAt));
  by.upcoming.sort((a, b) => at(a.startsAt) - at(b.startsAt) || at(a.endsAt) - at(b.endsAt));
  by.finished.sort((a, b) => at(b.startsAt) - at(a.startsAt) || at(b.endsAt) - at(a.endsAt));
  return (["open", "upcoming", "finished"] as const).filter((k) => by[k].length).map((key) => {
    const days: { day: string; heading: string; exams: T[] }[] = [];
    for (const e of by[key]) {
      const day = Number.isNaN(new Date(e.startsAt).getTime()) ? "" : dayOf(new Date(e.startsAt));
      const last = days[days.length - 1];
      if (last && last.day === day) last.exams.push(e); else days.push({ day, heading: dayHeading(e.startsAt, now), exams: [e] });
    }
    return { key, label: GROUP_LABEL[key], count: by[key].length, days };
  });
}

export function formatTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(d);
}

export function toLocalInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

export function fromLocalInput(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export function newQuestionId() {
  return "q-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export type ExamWindow = "upcoming" | "open" | "closed";
export function examWindow(startsAt: string, endsAt: string, now = Date.now()): ExamWindow {
  if (now < new Date(startsAt).getTime()) return "upcoming";
  if (now > new Date(endsAt).getTime()) return "closed";
  return "open";
}

type ExamTiming = { id: number; startsAt: string; endsAt: string };
type AttemptStatus = { examId: number; status: string };
/** The exams a student still has to act on: being written, open or upcoming. Finished and closed exams leave the list (scores are in the GradeSheet). */
export function activeStudentExams<T extends ExamTiming>(exams: T[], attempts: AttemptStatus[], now = Date.now()): T[] {
  const status = new Map(attempts.map((a) => [a.examId, a.status]));
  return exams.filter((e) => {
    const s = status.get(e.id);
    if (s) return s === "in_progress";
    return examWindow(e.startsAt, e.endsAt, now) !== "closed";
  });
}

/** Dashboard order: still writing, open now, upcoming, submitted, then closed. */
export function sortStudentExams<T extends ExamTiming>(exams: T[], attempts: AttemptStatus[], now = Date.now()): T[] {
  const status = new Map(attempts.map((a) => [a.examId, a.status]));
  const rank = (e: T) => {
    const s = status.get(e.id);
    if (s === "in_progress") return 0;
    if (s) return 3;
    const w = examWindow(e.startsAt, e.endsAt, now);
    return w === "open" ? 1 : w === "upcoming" ? 2 : 4;
  };
  const time = (e: T, r: number) => r === 1 ? new Date(e.endsAt).getTime() : r === 2 ? new Date(e.startsAt).getTime() : -new Date(e.startsAt).getTime();
  return [...exams].sort((a, b) => { const ra = rank(a), rb = rank(b); return ra - rb || time(a, ra) - time(b, rb); });
}

export function scrollToQuestion(id: string) {
  const el = document.getElementById("question-" + id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  // Move keyboard focus to the first answer control for screen-reader and keyboard users.
  window.setTimeout(() => el.querySelector<HTMLElement>("button:not(:disabled), textarea:not(:disabled)")?.focus({ preventScroll: true }), 350);
}

/** Gemstones, one word each, for student passwords such as "Emerald-4827". */
export const PASSWORD_WORDS = ["Emerald", "Aquamarine", "Morganite", "Heliodor", "Goshenite", "RedBeryl", "Jade", "Peridot", "Tourmaline", "Tsavorite",
  "Diopside", "Malachite", "Topaz", "Ruby", "Sapphire", "Diamond", "Opal", "Amethyst", "Citrine", "Garnet", "Onyx", "Turquoise", "Lapis", "Quartz",
  "Agate", "Zircon", "Tanzanite", "Spinel", "Moonstone", "Coral"];

/** An easy password to read out and type, such as "Emerald-4827": a gemstone, a dash and four digits (10+ characters). */
export function friendlyPassword() {
  const rand = (n: number) => {
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    for (;;) { crypto.getRandomValues(buf); if (buf[0] < limit) return buf[0] % n; }
  };
  const word = PASSWORD_WORDS[rand(PASSWORD_WORDS.length)];
  return `${word}-${String(rand(9000) + 1000)}`.padEnd(10, "7");
}
