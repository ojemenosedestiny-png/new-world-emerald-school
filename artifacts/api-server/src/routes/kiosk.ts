import { Router, type ErrorRequestHandler, type Request } from "express";
import cors from "cors";
import { and, eq, sql } from "drizzle-orm";
import { db, portalAttendance, portalClasses, portalStudents, tapCards, tapEvents, tapKiosks, tapSettings, type TapKioskRecord } from "@workspace/db";
import { PortalError, check } from "../lib/portal-auth";
import { publicRateLimit } from "../lib/public-rate-limit";
import { arrivalStatus, hashKioskKey, kioskKeyFrom, normaliseCardId, schoolDate, schoolTime, tapTime } from "../lib/tap-in";

/**
 * The address the school's card kiosks call (the Tapping software). Each tap marks the child in the daily register:
 * present, or late after the school's late time. No sign-in: a kiosk proves itself with its own secret key, sent as
 * `Authorization: Bearer <key>`. Answers carry a short message the kiosk can show on its screen.
 */
export const kioskRouter = Router();
// The key travels in a header, never a cookie, so a kiosk app running in a browser on any address may call this.
kioskRouter.use(cors({ origin: true, credentials: false, methods: ["GET", "POST"], allowedHeaders: ["Authorization", "Content-Type", "X-Kiosk-Key"], maxAge: 86_400 }));
kioskRouter.use(publicRateLimit("kiosk", 3_000, "Too many requests from this kiosk connection. Wait a few minutes.", 30_000));

export const MAX_TAPS_PER_REQUEST = 500;
const ATTENDANCE_STATUSES = new Set(["present", "late", "absent", "excused"]);

/** Why a key was not accepted, in words the person setting up the kiosk can act on (never echoes the key). */
export function keyProblem(key: string): string {
  if (!key.startsWith("nwek_")) return "This is not a kiosk key. Kiosk keys start with nwek_ : copy the key from the portal, Card tap-in, Add kiosk (or New key).";
  if (key.length !== KEY_LENGTH) return `This kiosk key is incomplete or has extra characters (it has ${key.length} characters; a kiosk key has ${KEY_LENGTH}). Copy it again with the Copy button in the portal.`;
  return "This kiosk key is not in use. It may have been replaced with New key, or its kiosk removed. In the portal, Card tap-in, press New key on the kiosk and paste the new key here.";
}
const KEY_LENGTH = 48;

async function kioskFor(req: Request): Promise<TapKioskRecord> {
  const key = kioskKeyFrom(req.headers);
  check(key, "Send the kiosk key as: Authorization: Bearer <key>.", 401);
  const [kiosk] = await db.select().from(tapKiosks).where(eq(tapKiosks.keyHash, hashKioskKey(key!)));
  check(kiosk, keyProblem(key!), 401);
  check(kiosk.active, "This kiosk has been turned off in the portal.", 403);
  await db.update(tapKiosks).set({ lastSeenAt: new Date() }).where(eq(tapKiosks.id, kiosk.id));
  return kiosk;
}

export async function lateAfter(): Promise<string> {
  const [row] = await db.select().from(tapSettings).where(eq(tapSettings.id, 1));
  return row?.lateAfter ?? "08:00";
}

export type TapResult = {
  ok: boolean;
  result: "present" | "late" | "already" | "unknown_card" | "inactive" | "refused";
  status: "present" | "late" | "absent" | "excused" | null;
  studentName: string | null;
  studentId: string | null;
  className: string | null;
  date: string;
  time: string;
  message: string;
  tapRef: string | null;
  repeat?: boolean;
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** One tap: find the card's student, mark the register if this is their first tap of the day, and log it. */
export async function recordTap(kiosk: TapKioskRecord, input: Record<string, unknown>, late: string, now = new Date()): Promise<TapResult> {
  const tapRef = typeof input.tapId === "string" || typeof input.tapId === "number" ? String(input.tapId).trim().slice(0, 100) || null : null;
  const base = { tapRef, studentName: null, studentId: null, className: null, status: null } as const;

  // A tap the kiosk already sent (it re-sends after a network failure): answer as before, change nothing.
  if (tapRef) {
    const [seen] = await db.select().from(tapEvents).where(and(eq(tapEvents.kioskId, kiosk.id), eq(tapEvents.tapRef, tapRef)));
    if (seen) {
      const [who] = seen.studentId ? await db.select({ name: portalStudents.name, studentId: portalStudents.studentId, className: portalClasses.name, status: portalAttendance.status })
        .from(portalStudents).innerJoin(portalClasses, eq(portalClasses.id, portalStudents.classId))
        .leftJoin(portalAttendance, and(eq(portalAttendance.studentId, portalStudents.id), eq(portalAttendance.date, seen.date)))
        .where(eq(portalStudents.id, seen.studentId)) : [];
      return {
        ...base, ok: ["present", "late", "already"].includes(seen.result), result: seen.result as TapResult["result"], repeat: true,
        status: (who?.status ?? null) as TapResult["status"], studentName: who?.name ?? null, studentId: who?.studentId ?? null, className: who?.className ?? null,
        date: seen.date, time: schoolTime(seen.tappedAt), message: seen.message,
      };
    }
  }

  const when = tapTime(input.tappedAt, now);
  if ("error" in when) return { ...base, ok: false, result: "refused", date: schoolDate(now), time: schoolTime(now), message: when.error };
  const at = when.at, date = schoolDate(at), time = schoolTime(at);
  const cardId = normaliseCardId(input.cardId);
  const schoolNumber = typeof input.studentId === "string" && input.studentId.trim() ? input.studentId.trim().slice(0, 60) : null;
  if (!cardId && !schoolNumber) return { ...base, ok: false, result: "refused", date, time, message: "Send the card number as cardId (letters and digits)." };

  const log = async (result: TapResult["result"], message: string, studentId: number | null) => {
    await db.insert(tapEvents).values({ kioskId: kiosk.id, kioskName: kiosk.name, tapRef, cardId: cardId ?? (schoolNumber ?? "").toUpperCase(), studentId, tappedAt: at, date, result, message })
      .onConflictDoNothing();
  };

  const pick = { id: portalStudents.id, name: portalStudents.name, studentId: portalStudents.studentId, classId: portalStudents.classId, active: portalStudents.active, className: portalClasses.name };
  const [student] = cardId
    ? await db.select(pick).from(tapCards).innerJoin(portalStudents, eq(portalStudents.id, tapCards.studentId)).innerJoin(portalClasses, eq(portalClasses.id, portalStudents.classId)).where(eq(tapCards.cardId, cardId))
    : await db.select(pick).from(portalStudents).innerJoin(portalClasses, eq(portalClasses.id, portalStudents.classId)).where(sql`lower(${portalStudents.studentId}) = ${schoolNumber!.toLowerCase()}`);
  if (!student) {
    const message = cardId ? "This card is not linked to a student yet. Please see the school office." : "No student has that student ID.";
    await log("unknown_card", message, null);
    return { ...base, ok: false, result: "unknown_card", date, time, message };
  }
  const who = { studentName: student.name, studentId: student.studentId, className: student.className };
  if (!student.active) {
    const message = `${student.name} is not an active student. Please see the school office.`;
    await log("inactive", message, student.id);
    return { ...base, ...who, ok: false, result: "inactive", date, time, message };
  }

  // Marks the register only when there is no mark yet for the day, or the mark is "absent" (the child did come).
  const arrival = arrivalStatus(at, late);
  const note = `Tapped in at ${time} (${kiosk.name})`.slice(0, 200);
  const markedBy = `Card tap: ${kiosk.name}`.slice(0, 200);
  const changed = await db.insert(portalAttendance)
    .values({ classId: student.classId, studentId: student.id, date, status: arrival, note, markedBy, markedAt: new Date() })
    .onConflictDoUpdate({
      target: [portalAttendance.studentId, portalAttendance.date],
      set: { status: arrival, note, classId: student.classId, markedBy, markedAt: new Date() },
      setWhere: eq(portalAttendance.status, "absent"),
    })
    .returning({ status: portalAttendance.status });

  if (changed.length) {
    const message = arrival === "late"
      ? `Good morning, ${firstName(student.name)}. You are late: marked at ${time}.`
      : `Welcome, ${firstName(student.name)}. Marked present at ${time}.`;
    await log(arrival, message, student.id);
    return { ...base, ...who, ok: true, result: arrival, status: arrival, date, time, message };
  }
  const [row] = await db.select({ status: portalAttendance.status }).from(portalAttendance).where(and(eq(portalAttendance.studentId, student.id), eq(portalAttendance.date, date)));
  const status = (row && ATTENDANCE_STATUSES.has(row.status) ? row.status : "present") as TapResult["status"];
  const message = `${firstName(student.name)} is already marked ${status} today.`;
  await log("already", message, student.id);
  return { ...base, ...who, ok: true, result: "already", status, date, time, message };
}

/** Checks the kiosk's key and connection: the kiosk's name, the school's date and time, and the late time. */
kioskRouter.get("/ping", async (req, res) => {
  const kiosk = await kioskFor(req);
  const now = new Date();
  res.json({ ok: true, kiosk: kiosk.name, date: schoolDate(now), time: schoolTime(now), lateAfter: await lateAfter() });
});

/** One tap `{ cardId, tappedAt?, tapId? }`, or several sent together after being offline: `{ taps: [ ... ] }`. */
kioskRouter.post("/tap", async (req, res) => {
  const kiosk = await kioskFor(req);
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body as Record<string, unknown> : null;
  check(body, "Send JSON like {\"cardId\": \"04A1B2C3\"}.");
  const late = await lateAfter();
  if (Array.isArray(body!.taps)) {
    const taps = body!.taps as unknown[];
    check(taps.length > 0, "The taps list is empty.");
    check(taps.length <= MAX_TAPS_PER_REQUEST, `Send at most ${MAX_TAPS_PER_REQUEST} taps at a time.`, 413);
    const results: TapResult[] = [];
    for (const t of taps) results.push(t && typeof t === "object" && !Array.isArray(t)
      ? await recordTap(kiosk, t as Record<string, unknown>, late)
      : { ok: false, result: "refused", status: null, studentName: null, studentId: null, className: null, date: schoolDate(), time: schoolTime(new Date()), message: "Each tap must be an object.", tapRef: null });
    res.json({ ok: true, results });
    return;
  }
  res.json(await recordTap(kiosk, body!, late));
});

const errors: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof PortalError) { res.status(error.status).json({ ok: false, error: error.message, message: error.message }); return; }
  req.log?.error({ err: error }, "Kiosk request failed");
  res.status(500).json({ ok: false, error: "The school portal could not record this tap. Try again.", message: "Please try again." });
};
kioskRouter.use(errors);
