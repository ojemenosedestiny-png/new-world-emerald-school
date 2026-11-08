/**
 * Who the Director and the Head of School can email, and how each email reads. Pure functions, unit tested.
 * Only teachers and the parents of current students can be chosen: never any other address.
 */

export type Recipient = { kind: "teacher" | "parent"; email: string; name: string; greeting: string; detail: string; classIds: number[] };

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const clean = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();

/** "Ada Obi", "Ada Obi and Ben Obi", "Ada, Ben and Chi Obi" style lists. */
export function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Every active teacher, and every parent email on a current student (first or second parent), each once. */
export function schoolDirectory(
  teachers: { email: string; name: string; active: boolean; classIds: number[] }[],
  students: { name: string; studentId: string; classId: number; active: boolean; guardianEmail: string | null; secondGuardianEmail: string | null }[],
  className: Map<number, string>,
): Recipient[] {
  const out: Recipient[] = [];
  for (const t of teachers) {
    const email = clean(t.email);
    if (!t.active || !EMAIL.test(email)) continue;
    out.push({ kind: "teacher", email, name: t.name, greeting: `Dear ${t.name}`, detail: t.classIds.map((id) => className.get(id)).filter(Boolean).join(", "), classIds: t.classIds });
  }
  const parents = new Map<string, typeof students>();
  for (const s of students) {
    if (!s.active) continue;
    for (const raw of [s.guardianEmail, s.secondGuardianEmail]) {
      const email = clean(raw);
      if (!EMAIL.test(email)) continue;
      parents.set(email, [...(parents.get(email) ?? []), s]);
    }
  }
  for (const [email, kids] of parents) {
    const names = [...new Set(kids.map((k) => k.name))];
    out.push({
      kind: "parent", email, name: `Parent of ${joinNames(names)}`, greeting: `Dear Parent of ${joinNames(names)}`,
      detail: kids.map((k) => `${k.name} (${className.get(k.classId) ?? "no class"})`).join(", "), classIds: [...new Set(kids.map((k) => k.classId))],
    });
  }
  return out;
}

export const MAX_RECIPIENTS_PER_EMAIL = 1000;
export const dailyLimit = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.SCHOOL_EMAIL_DAILY_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : 500;
};

/** Why an email cannot be sent, or null. */
export function emailProblem(subject: string, message: string, recipients: number, sentToday: number, limit: number): string | null {
  if (!subject.trim()) return "Add a subject.";
  if (subject.length > 150) return "Keep the subject under 150 characters.";
  if (/[\r\n]/.test(subject)) return "The subject must be one line.";
  if (!message.trim()) return "Write a message.";
  if (message.length > 10_000) return "Keep the message under 10,000 characters.";
  if (!recipients) return "Choose at least one teacher or parent.";
  if (recipients > MAX_RECIPIENTS_PER_EMAIL) return `Choose at most ${MAX_RECIPIENTS_PER_EMAIL} people in one email.`;
  if (sentToday + recipients > limit) return `The school sends up to ${limit} emails a day; ${Math.max(0, limit - sentToday)} are left today. Choose fewer people or send the rest tomorrow.`;
  return null;
}
