// Who the Director's staff emails go to. Only teachers and administrators: never students or parents.

export type Audience = "teachers" | "admins" | "all";
export const MAX_RECIPIENTS = 200;
export const BROADCASTS_PER_DAY = 10;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** Active teachers and/or approved administrators, de-duplicated, in lower case. */
export function broadcastRecipients(audience: Audience, teachers: { email: string; active: boolean }[], adminEmails: string[]) {
  const list: string[] = [];
  if (audience !== "admins") list.push(...teachers.filter((t) => t.active).map((t) => t.email));
  if (audience !== "teachers") list.push(...adminEmails);
  return [...new Set(list.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL.test(e)))].sort();
}

export function broadcastProblem(subject: string, message: string): string | null {
  if (!subject.trim()) return "Add a subject.";
  if (subject.length > 150) return "Keep the subject under 150 characters.";
  if (/[\r\n]/.test(subject)) return "The subject must be one line.";
  if (!message.trim()) return "Write a message.";
  if (message.length > 10_000) return "Keep the message under 10,000 characters.";
  return null;
}
