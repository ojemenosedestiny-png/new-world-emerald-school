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

export function generateTempPassword(length = 16) {
  const sets = ["ABCDEFGHJKMNPQRSTUVWXYZ", "abcdefghjkmnpqrstuvwxyz", "23456789", "!@#%*?-+"];
  const all = sets.join("");
  // unbiased random index via rejection sampling
  const rand = (n: number) => {
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    for (;;) { crypto.getRandomValues(buf); if (buf[0] < limit) return buf[0] % n; }
  };
  const chars = sets.map((set) => set[rand(set.length)]);
  while (chars.length < length) chars.push(all[rand(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = rand(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
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
