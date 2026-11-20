import type { PortalActor } from "./portal-auth";

export type Channel = "class" | "office" | "teacher";
/** The conversations every student has; private "teacher" conversations are added as the student starts them. */
export const CHANNELS: Channel[] = ["class", "office"];
export const MAX_MESSAGE_LENGTH = 1000;
/** A student may send this many messages in any ten-minute window. */
export const STUDENT_SEND_LIMIT = 20;
export const SEND_WINDOW_MS = 10 * 60_000;
/** Messages returned per conversation (the newest ones). */
export const THREAD_LIMIT = 200;

/**
 * Who may read and answer a conversation. The office (administrators) sees every conversation so it can safeguard
 * students; a teacher sees the class channel of students in their own classes, and private conversations a student
 * started with them alone. No other teacher sees a private conversation.
 */
export function staffMayOpen(actor: Pick<PortalActor, "role" | "classIds" | "teacherId">, channel: Channel, studentClassId: number, teacherId?: number | null) {
  if (actor.role === "admin") return true;
  if (actor.role !== "teacher") return false;
  if (channel === "teacher") return !!actor.teacherId && actor.teacherId === teacherId;
  return channel === "class" && actor.classIds.includes(studentClassId);
}

export function cleanBody(raw: string): string | null {
  // Keep line breaks, drop control characters, cap blank runs.
  const body = raw.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return body && body.length <= MAX_MESSAGE_LENGTH ? body : null;
}

export const threadTitle = (channel: Channel, className: string) => (channel === "office" ? "School office" : `Class teacher${className ? ` (${className})` : ""}`);
