import { createHash, randomBytes } from "node:crypto";

export const ACTIVATION_HOURS = 72;
export const RESET_HOURS = 24;

export type IdSection = "primary" | "secondary";
export const ID_SECTION_CODE: Record<IdSection, string> = { primary: "PRY", secondary: "SEC" };
/** The school's admission number style: NW/SEC/26/00001 (secondary) or NW/PRY/26/00001 (primary). */
export const ADMISSION_NUMBER = /^NW\/(SEC|PRY)\/\d{2}\/\d{5,6}$/;

/**
 * NW/SEC/26/00001: school, section (SEC secondary, PRY primary), two-digit year of admission, and a five-digit number
 * that runs on through the years for each section.
 */
export function formatStudentId(section: IdSection, year: number, n: number) {
  return `NW/${ID_SECTION_CODE[section]}/${String(year % 100).padStart(2, "0")}/${String(n).padStart(5, "0")}`;
}

/** Null when acceptable; otherwise what is wrong with a new password. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 128) return "Use at most 128 characters.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Include at least one letter and one number.";
  return null;
}

export const validEmail = (email: string) => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 200;

/**
 * Trusted public address for links in emails. Never derived from the request's Host header,
 * which an attacker could forge to send a reset link pointing at another site.
 */
export function siteBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.PUBLIC_SITE_URL || env.RENDER_EXTERNAL_URL || "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^/\s]+$/.test(raw) ? raw : null;
}

export function newAccountToken() {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashAccountToken(token) };
}
export const hashAccountToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const validTokenShape = (token: unknown): token is string => typeof token === "string" && /^[a-f0-9]{64}$/.test(token);

export function accountLink(base: string, token: string) {
  // The token travels in the query string, which request logs strip.
  return `${base}/portal/activate?t=${token}`;
}

/**
 * What a teacher may change on an existing student in their class: only issue a new password. Name, status and
 * parent email stay with the school office. Returns the reason it is refused, or null.
 */
export function teacherStudentEditProblem(old: { name: string; active: boolean }, next: { name: string; active: boolean; newPassword: boolean; guardianEmailChanged: boolean }) {
  // Teachers may correct a misspelled name and issue a new password; activation and parent emails stay with the office.
  if (old.active !== next.active || next.guardianEmailChanged) {
    return "Teachers can correct a student's name or give a new password. Ask the school office to change other details.";
  }
  if (!next.newPassword && old.name === next.name) return "Nothing to change. Correct the name or give a new password.";
  return null;
}
