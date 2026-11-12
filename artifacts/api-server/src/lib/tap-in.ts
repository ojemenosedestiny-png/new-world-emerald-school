import { createHash, randomBytes } from "node:crypto";
import { SCHOOL_TIME_ZONE, schoolDate } from "./learning";

/** A new kiosk key: shown to the office once, never stored (only its hash is). */
export function newKioskKey() {
  const key = `nwek_${randomBytes(32).toString("base64url")}`;
  return { key, hash: hashKioskKey(key), hint: key.slice(-4) };
}
export const hashKioskKey = (key: string) => createHash("sha256").update(key.trim()).digest("hex");

/** The kiosk's key from `Authorization: Bearer <key>` or an `X-Kiosk-Key` header. */
export function kioskKeyFrom(headers: Record<string, string | string[] | undefined>): string | null {
  const auth = headers.authorization;
  // Forgiving of how a key was pasted: surrounding quotes, or "Bearer " typed in front of it twice.
  const clean = (v: string) => v.trim().replace(/^(Bearer\s+)+/i, "").replace(/^["'<\s]+|["'>\s.,;]+$/g, "") || null;
  if (typeof auth === "string" && /^Bearer\s+\S/i.test(auth.trim())) return clean(auth);
  const x = headers["x-kiosk-key"];
  return typeof x === "string" && x.trim() ? clean(x) : null;
}

/**
 * A card number as the portal stores it: capitals, no spaces, colons or dashes ("04:a1:2b" and "04A12B" are the
 * same card). Null when it is not a card number.
 */
export function normaliseCardId(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const v = String(raw).trim().toUpperCase().replace(/[\s:\-.]/g, "");
  return /^[A-Z0-9]{2,64}$/.test(v) ? v : null;
}

/** "07:45" style time of day, 24-hour. */
export const isTimeOfDay = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** The school's clock time (HH:MM, 24-hour) at a moment. */
export function schoolTime(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: SCHOOL_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

export const MAX_TAP_AGE_DAYS = 7;

/**
 * When a tap happened. The kiosk may send the time it was tapped (useful when it was offline and sends taps later);
 * without one, now. A time slightly in the future (a fast kiosk clock) counts as now; too far back is refused.
 */
export function tapTime(sent: unknown, now = new Date()): { at: Date } | { error: string } {
  if (sent === undefined || sent === null || sent === "") return { at: now };
  const at = typeof sent === "number" ? new Date(sent < 1e12 ? sent * 1000 : sent) : typeof sent === "string" ? new Date(sent) : new Date(Number.NaN);
  if (Number.isNaN(at.getTime())) return { error: "The tap time is not a valid date and time." };
  if (at.getTime() > now.getTime() + 10 * 60_000) return { at: now };
  if (at.getTime() < now.getTime() - MAX_TAP_AGE_DAYS * 86_400_000) return { error: `Taps older than ${MAX_TAP_AGE_DAYS} days are not counted.` };
  return { at };
}

export type TapStatus = "present" | "late";

/** The first tap of the day: present up to and including the late time, late after it. */
export function arrivalStatus(at: Date, lateAfter: string): TapStatus {
  return schoolTime(at) > lateAfter ? "late" : "present";
}

/**
 * What a tap does to a register that may already have a mark for that day. Only an absence is changed (the child
 * did come in: present or late by the clock); any other mark (present, late, excused) stays as it is.
 */
export function registerChange(existing: string | null, arrival: TapStatus): TapStatus | null {
  if (existing === null || existing === "absent") return arrival;
  return null;
}

export { schoolDate };
