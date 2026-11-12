import { Router, type Request } from "express";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, portalAttendance, portalClasses, portalStudents, tapCards, tapEvents, tapKiosks, tapSettings } from "@workspace/db";
import { ManageTapInBody } from "@workspace/api-zod";
import { check } from "../lib/portal-auth";
import { isWebsiteAdmin } from "../lib/website-admin";
import { siteOrigin } from "../lib/seo";
import { addDays } from "../lib/learning";
import { isTimeOfDay, newKioskKey, normaliseCardId, schoolDate } from "../lib/tap-in";
import { lateAfter } from "./kiosk";

/**
 * Card tap-in for the school office: create a key for each kiosk, link students' cards, set the late time and watch
 * taps arrive. New cards tapped on a kiosk show up here, ready to be linked to a student.
 */
export const portalTapInRouter = Router();
export const MAX_KIOSKS = 20;

function office(req: Request) {
  check(req.identity, "Sign in first.", 401);
  check(isWebsiteAdmin(req), "Card tap-in is managed by the school office.", 403);
  return req.identity!.email ?? "school office";
}

portalTapInRouter.get("/tap-in", async (req, res) => {
  office(req);
  const today = schoolDate();
  const since = new Date(Date.now() - 3 * 86_400_000);
  const [kiosks, cards, recent, unknown, counts, late] = await Promise.all([
    db.select().from(tapKiosks).orderBy(asc(tapKiosks.name)),
    db.select({ id: tapCards.id, cardId: tapCards.cardId, studentId: tapCards.studentId, studentName: portalStudents.name, studentNumber: portalStudents.studentId, className: portalClasses.name, createdAt: tapCards.createdAt })
      .from(tapCards).innerJoin(portalStudents, eq(portalStudents.id, tapCards.studentId)).innerJoin(portalClasses, eq(portalClasses.id, portalStudents.classId))
      .orderBy(asc(portalStudents.name)),
    db.select({ e: tapEvents, studentName: portalStudents.name, className: portalClasses.name }).from(tapEvents)
      .leftJoin(portalStudents, eq(portalStudents.id, tapEvents.studentId)).leftJoin(portalClasses, eq(portalClasses.id, portalStudents.classId))
      .where(gte(tapEvents.receivedAt, since)).orderBy(desc(tapEvents.tappedAt)).limit(200),
    // Cards tapped in the last two weeks that are still not linked to anyone.
    db.select({ cardId: tapEvents.cardId, lastAt: sql<Date>`max(${tapEvents.tappedAt})`, kioskName: sql<string>`max(${tapEvents.kioskName})`, taps: sql<number>`count(*)::int` })
      .from(tapEvents).leftJoin(tapCards, eq(tapCards.cardId, tapEvents.cardId))
      .where(and(eq(tapEvents.result, "unknown_card"), isNull(tapCards.id), gte(tapEvents.date, addDays(today, -14))))
      .groupBy(tapEvents.cardId).orderBy(desc(sql`max(${tapEvents.tappedAt})`)).limit(100),
    db.select({ status: portalAttendance.status, n: sql<number>`count(*)::int` }).from(portalAttendance)
      .where(and(eq(portalAttendance.date, today), sql`${portalAttendance.markedBy} like 'Card tap:%'`)).groupBy(portalAttendance.status),
    lateAfter(),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  res.json({
    lateAfter: late,
    tapAddress: `${siteOrigin()}/api/kiosk/tap`,
    kiosks: kiosks.map((k) => ({ id: k.id, name: k.name, keyHint: k.keyHint, active: k.active, lastSeenAt: k.lastSeenAt?.toISOString() ?? null, createdAt: k.createdAt.toISOString() })),
    cards: cards.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
    recent: recent.map(({ e, studentName, className }) => ({ id: e.id, at: e.tappedAt.toISOString(), kioskName: e.kioskName, cardId: e.cardId, studentName, className, result: e.result, message: e.message })),
    unknownCards: unknown.filter((u) => u.cardId).map((u) => ({ cardId: u.cardId, lastAt: new Date(u.lastAt).toISOString(), kioskName: u.kioskName, taps: u.taps })),
    today: { date: today, tapped: count("present") + count("late"), present: count("present"), late: count("late") },
  });
});

portalTapInRouter.post("/tap-in", async (req, res) => {
  const by = office(req);
  const body = ManageTapInBody.parse(req.body);
  const kioskName = () => {
    const name = (body.name ?? "").trim().replace(/\s+/g, " ");
    check(name.length >= 2 && name.length <= 60, "Give the kiosk a name, like Main gate.");
    return name;
  };
  const kiosk = async () => {
    check(body.kioskId, "Choose a kiosk.");
    const [k] = await db.select().from(tapKiosks).where(eq(tapKiosks.id, body.kioskId!));
    check(k, "That kiosk no longer exists.", 404);
    return k;
  };

  switch (body.action) {
    case "addKiosk": {
      const name = kioskName();
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(tapKiosks);
      check(n < MAX_KIOSKS, `Up to ${MAX_KIOSKS} kiosks.`);
      const k = newKioskKey();
      await db.insert(tapKiosks).values({ name, keyHash: k.hash, keyHint: k.hint, createdBy: by });
      res.json({ message: `Kiosk "${name}" added. Copy its key now: it is shown only once.`, key: k.key });
      return;
    }
    case "renameKiosk": {
      const k = await kiosk();
      const name = kioskName();
      await db.update(tapKiosks).set({ name }).where(eq(tapKiosks.id, k.id));
      res.json({ message: `Renamed to "${name}".` });
      return;
    }
    case "setKioskActive": {
      const k = await kiosk();
      check(typeof body.active === "boolean", "Choose on or off.");
      await db.update(tapKiosks).set({ active: body.active }).where(eq(tapKiosks.id, k.id));
      res.json({ message: body.active ? `"${k.name}" is on again.` : `"${k.name}" is turned off: its taps are refused.` });
      return;
    }
    case "newKioskKey": {
      const k = await kiosk();
      const fresh = newKioskKey();
      await db.update(tapKiosks).set({ keyHash: fresh.hash, keyHint: fresh.hint }).where(eq(tapKiosks.id, k.id));
      res.json({ message: `New key for "${k.name}". The old key stops working now. Copy the new key: it is shown only once.`, key: fresh.key });
      return;
    }
    case "deleteKiosk": {
      const k = await kiosk();
      await db.delete(tapKiosks).where(eq(tapKiosks.id, k.id));
      res.json({ message: `"${k.name}" removed. Its past taps stay in the register.` });
      return;
    }
    case "assignCard": {
      const cardId = normaliseCardId(body.cardId);
      check(cardId, "Type or tap the card number (letters and digits).");
      check(body.studentId, "Choose the student.");
      const [student] = await db.select({ id: portalStudents.id, name: portalStudents.name }).from(portalStudents).where(eq(portalStudents.id, body.studentId!));
      check(student, "That student no longer exists.", 404);
      const [owner] = await db.select({ studentId: tapCards.studentId, name: portalStudents.name }).from(tapCards)
        .innerJoin(portalStudents, eq(portalStudents.id, tapCards.studentId)).where(eq(tapCards.cardId, cardId!));
      if (owner) {
        check(owner.studentId !== student.id, `That card is already ${student.name}'s.`, 409);
        check(false, `That card belongs to ${owner.name}. Remove it from them first.`, 409);
      }
      await db.insert(tapCards).values({ cardId: cardId!, studentId: student.id, createdBy: by });
      res.json({ message: `Card ${cardId} is now ${student.name}'s. Their next tap marks them in.` });
      return;
    }
    case "removeCard": {
      check(body.cardRowId, "Choose the card.");
      const [row] = await db.delete(tapCards).where(eq(tapCards.id, body.cardRowId!)).returning();
      check(row, "That card was already removed.", 404);
      res.json({ message: `Card ${row.cardId} removed. Taps with it are no longer counted.` });
      return;
    }
    case "setLateAfter": {
      const t = (body.lateAfter ?? "").trim();
      check(isTimeOfDay(t), "Write the time like 07:45 (24-hour).");
      await db.insert(tapSettings).values({ id: 1, lateAfter: t, updatedBy: by, updatedAt: new Date() })
        .onConflictDoUpdate({ target: tapSettings.id, set: { lateAfter: t, updatedBy: by, updatedAt: new Date() } });
      res.json({ message: `Children who tap in after ${t} are marked late.` });
      return;
    }
  }
});
