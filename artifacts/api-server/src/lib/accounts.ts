import { createHash, randomBytes } from "node:crypto";

export const ACTIVATION_HOURS = 72;
export const RESET_HOURS = 24;

/** NWE/2026/00001: school prefix, enrolment year, five-digit number. */
export function formatStudentId(year: number, n: number) {
  return `NWE/${year}/${String(n).padStart(5, "0")}`;
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
