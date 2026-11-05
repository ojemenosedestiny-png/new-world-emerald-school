import { termForReference } from "./term-names";

// Hostel and transport rules, free of the database so they can be unit tested.

export const GENDERS = ["boys", "girls", "mixed"] as const;
export const MAX_KOBO = 2_000_000_000; // NGN 20,000,000, within a database integer

export function roomStatus(beds: number, occupied: number): "available" | "full" {
  return occupied >= beds ? "full" : "available";
}

/** Whether a student can take a bed in a room: space left, unless they are already in it; bed labels are unique in a room. */
export function allocationProblem(room: { beds: number }, occupants: { studentId: number; bed: string }[], studentId: number, bed: string): string | null {
  const others = occupants.filter((o) => o.studentId !== studentId);
  if (others.length >= room.beds) return "This room is full. Choose another room or add bed spaces.";
  const label = bed.trim().toLowerCase();
  if (label && others.some((o) => o.bed.trim().toLowerCase() === label)) return `${bed.trim()} is already taken in this room.`;
  return null;
}

export function roomProblem(r: { name: string; beds: number; priceKobo: number }, occupied: number): string | null {
  if (!r.name.trim()) return "Give the room a name or number.";
  if (!Number.isInteger(r.beds) || r.beds < 1 || r.beds > 100) return "Bed spaces must be 1 to 100.";
  if (r.beds < occupied) return `${occupied} students are in this room. Move some out before reducing it to ${r.beds} bed spaces.`;
  if (!Number.isInteger(r.priceKobo) || r.priceKobo < 0 || r.priceKobo > MAX_KOBO) return "Enter a valid price.";
  return null;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Stops in order: each needs a name; times are optional but must look like 07:15. */
export function stopsProblem(stops: { name: string; pickup: string; dropoff: string }[]): string | null {
  if (!stops.length) return "Add at least one stop.";
  if (stops.length > 40) return "A route can have up to 40 stops.";
  for (const [i, s] of stops.entries()) {
    if (!s.name.trim()) return `Stop ${i + 1} needs a name.`;
    if (s.pickup && !TIME.test(s.pickup)) return `Pick-up time at ${s.name} should look like 07:15.`;
    if (s.dropoff && !TIME.test(s.dropoff)) return `Drop-off time at ${s.name} should look like 15:30.`;
  }
  if (new Set(stops.map((s) => s.name.trim().toLowerCase())).size !== stops.length) return "Each stop name can be used once on a route.";
  return null;
}

/** A Nigerian phone number for the driver: digits, spaces and an optional leading +, 7 to 20 characters. */
export const validPhone = (p: string) => p === "" || /^\+?[\d\s-]{7,20}$/.test(p.trim());

/** Photos must be web addresses or the site's own public paths; never javascript: or data: links. */
export const safeImageUrl = (u: string) => u === "" || /^https:\/\/[^\s"'<>]+$/i.test(u) || /^\/[^\s"'<>]*$/.test(u);

export type FeeKind = "hostel" | "bus";
/** A boarder (room price) or a bus rider (route fee) to be billed for a term. */
export type FacilityBillee = { kind: FeeKind; studentCode: string; studentName: string; className: string; place: string; amountKobo: number };

const refPart = (v: string) => v.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * The fee charge for each boarder and rider for one term. The reference is fixed for a student, term and kind,
 * so billing a term twice never charges anyone twice. Free rooms and routes (₦0) are not billed.
 */
export function facilityCharges(term: string, academicYear: string, billees: FacilityBillee[]) {
  return billees.filter((b) => b.amountKobo > 0).map((b) => ({
    reference: [b.kind === "hostel" ? "HOSTEL" : "BUS", refPart(academicYear), refPart(termForReference(term)), refPart(b.studentCode)].join("-"),
    studentName: b.studentName, studentIdentifier: b.studentCode, className: b.className,
    term: term.trim(), academicYear: academicYear.trim(),
    description: b.kind === "hostel" ? `Hostel: ${b.place}` : `School bus: ${b.place}`,
    amountKobo: b.amountKobo,
  }));
}

/** Why a term cannot be billed, or null. The session is written like 2026/2027. */
export function billingProblem(term: string, academicYear: string, kinds: FeeKind[]) {
  if (!term.trim()) return "Choose the term.";
  const m = /^(\d{4})\/(\d{4})$/.exec(academicYear.trim());
  if (!m || Number(m[2]) !== Number(m[1]) + 1) return "Write the session like 2026/2027.";
  if (!kinds.length) return "Choose hostel fees, bus fees or both.";
  return null;
}
