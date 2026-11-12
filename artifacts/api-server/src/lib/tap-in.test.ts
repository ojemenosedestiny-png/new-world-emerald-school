import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pool, portalAttendance, portalClasses, portalStudents, tapCards, tapEvents, tapKiosks, tapSettings } from "@workspace/db";
import portalRouter from "../routes/portal";
import { keyProblem, kioskRouter } from "../routes/kiosk";
import { setApprovedIdentitiesForTest } from "./approved-identities";
import { addDays, schoolDate } from "./learning";
import { arrivalStatus, kioskKeyFrom, normaliseCardId, registerChange, schoolTime, tapTime } from "./tap-in";

test("tap-in rules: card numbers, times, late and the register", () => {
  assert.equal(normaliseCardId(" 04:a1:2b-3c "), "04A12B3C");
  assert.equal(normaliseCardId(1234567890), "1234567890");
  assert.equal(normaliseCardId("x"), null);
  assert.equal(normaliseCardId("<script>"), null);
  assert.equal(normaliseCardId(undefined), null);
  assert.equal(kioskKeyFrom({ authorization: "Bearer abc" }), "abc");
  assert.equal(kioskKeyFrom({ "x-kiosk-key": " k " }), "k");
  assert.equal(kioskKeyFrom({}), null);
  assert.equal(kioskKeyFrom({ authorization: "Bearer Bearer nwek_abc" }), "nwek_abc", "Bearer pasted with the key");
  assert.equal(kioskKeyFrom({ authorization: 'Bearer "nwek_abc" ' }), "nwek_abc", "quotes around the key");
  assert.match(keyProblem("sk_live_123"), /not a kiosk key/);
  assert.match(keyProblem("nwek_short"), /incomplete/);
  assert.match(keyProblem(`nwek_${"a".repeat(43)}`), /not in use/);
  // Lagos is UTC+1.
  assert.equal(schoolTime(new Date("2026-11-12T06:59:00Z")), "07:59");
  assert.equal(arrivalStatus(new Date("2026-11-12T07:00:00Z"), "08:00"), "present", "08:00 exactly is on time");
  assert.equal(arrivalStatus(new Date("2026-11-12T07:01:00Z"), "08:00"), "late");
  const now = new Date("2026-11-12T08:00:00Z");
  assert.deepEqual(tapTime(undefined, now), { at: now });
  assert.deepEqual(tapTime("2026-11-12T09:00:00Z", now), { at: now }, "a fast kiosk clock counts as now");
  assert.ok("error" in tapTime("2026-10-01T08:00:00Z", now));
  assert.ok("error" in tapTime("yesterday", now));
  assert.equal((tapTime(1_794_470_400, now) as { at: Date }).at.getTime(), 1_794_470_400_000, "seconds since 1970 accepted");
  assert.equal(registerChange(null, "late"), "late");
  assert.equal(registerChange("absent", "present"), "present");
  assert.equal(registerChange("excused", "present"), null);
  assert.equal(registerChange("late", "present"), null);
});

test("card tap-in: office sets up a kiosk and cards; taps mark the register once", async () => {
  const marker = `QA-TAP-${randomUUID().slice(0, 8)}`.toUpperCase();
  const m = marker.toLowerCase();
  const office = `office-${m}@example.test`, teacher = `teacher-${m}@example.test`;
  const saved = { SCHOOL_ADMIN_EMAILS: process.env.SCHOOL_ADMIN_EMAILS };
  process.env.SCHOOL_ADMIN_EMAILS = office;
  setApprovedIdentitiesForTest([office, teacher].map((e) => [`id-${e}`, { email: e, mfa: true }]));
  const [setting] = await db.select().from(tapSettings).where(eq(tapSettings.id, 1));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    const who = req.headers["x-test-user"];
    if (typeof who === "string") { req.dbUser = { id: `id-${who}` } as NonNullable<typeof req.dbUser>; req.identity = { email: who, emailVerified: true, mfa: true }; }
    next();
  });
  app.use("/api/portal", portalRouter);
  app.use("/api/kiosk", kioskRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (path: string, headers: Record<string, string>, body?: unknown): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const staff = (body?: unknown, who = office) => call("/portal/tap-in", { "X-Test-User": who }, body);
  const kioskIds: number[] = [];
  let classId = 0;
  try {
    const [cls] = await db.insert(portalClasses).values({ name: `${marker} JSS 2 Amber` }).returning();
    classId = cls.id;
    const [ada, bayo, gone] = await db.insert(portalStudents).values([
      { studentId: `${marker}-1`, name: "Ada Obi", classId, passwordHash: "x" },
      { studentId: `${marker}-2`, name: "Bayo Ade", classId, passwordHash: "x" },
      { studentId: `${marker}-3`, name: "Old Leaver", classId, passwordHash: "x", active: false },
    ]).returning();

    // Only the office.
    assert.equal((await call("/portal/tap-in", {})).status, 401);
    assert.equal((await staff(undefined, teacher)).status, 403);
    assert.equal((await staff({ action: "addKiosk", name: "Gate" }, teacher)).status, 403);

    // A kiosk and its key, shown once.
    const added = await staff({ action: "addKiosk", name: `${marker} Main gate` });
    assert.equal(added.status, 200, JSON.stringify(added.data));
    const key: string = added.data.key;
    assert.match(key, /^nwek_[A-Za-z0-9_-]{40,}$/);
    const [kiosk] = await db.select().from(tapKiosks).where(eq(tapKiosks.name, `${marker} Main gate`));
    kioskIds.push(kiosk.id);
    assert.notEqual(kiosk.keyHash, key, "only the hash is stored");
    const auth = { Authorization: `Bearer ${key}` };

    // The kiosk connects; a wrong or missing key is refused.
    const ping = await call("/kiosk/ping", auth);
    assert.equal(ping.status, 200);
    assert.equal(ping.data.kiosk, `${marker} Main gate`);
    assert.equal((await call("/kiosk/ping", {})).status, 401);
    assert.equal((await call("/kiosk/ping", { Authorization: "Bearer nwek_wrong" })).status, 401);
    assert.equal((await call("/kiosk/tap", { Authorization: "Bearer nwek_wrong" }, { cardId: "AA11" })).status, 401);

    // Late after 08:00 (school time). Taps from yesterday morning, as an offline kiosk sends them later.
    assert.equal((await staff({ action: "setLateAfter", lateAfter: "8am" })).status, 400);
    assert.equal((await staff({ action: "setLateAfter", lateAfter: "08:00" })).status, 200);
    const day = addDays(schoolDate(), -1);
    const at = (hhmm: string) => `${day}T${hhmm}:00+01:00`;
    const adaCard = `${marker.slice(-8)}01`.replace(/[^A-Z0-9]/g, "");
    const bayoCard = `${marker.slice(-8)}02`.replace(/[^A-Z0-9]/g, "");

    // A new card is not anyone's yet: it shows up for the office to link.
    const unknown = await call("/kiosk/tap", auth, { cardId: adaCard.toLowerCase(), tappedAt: at("07:20"), tapId: `${marker}-t1` });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.data.result, "unknown_card");
    assert.equal(unknown.data.ok, false);
    let ov = await staff();
    assert.ok(ov.data.unknownCards.some((u: { cardId: string }) => u.cardId === adaCard), "new card listed");
    assert.equal(ov.data.tapAddress.endsWith("/api/kiosk/tap"), true);

    // Link it; a card cannot belong to two students.
    assert.equal((await staff({ action: "assignCard", cardId: adaCard, studentId: ada.id })).status, 200);
    assert.equal((await staff({ action: "assignCard", cardId: ` ${adaCard.toLowerCase()} `, studentId: bayo.id })).status, 409);
    assert.equal((await staff({ action: "assignCard", cardId: bayoCard, studentId: bayo.id })).status, 200);
    ov = await staff();
    assert.ok(!ov.data.unknownCards.some((u: { cardId: string }) => u.cardId === adaCard), "linked card leaves the new list");

    // First tap: present (07:30); the same tap re-sent counts once; a second tap is "already".
    const t1 = await call("/kiosk/tap", auth, { cardId: adaCard, tappedAt: at("07:30"), tapId: `${marker}-t2` });
    assert.equal(t1.data.result, "present", JSON.stringify(t1.data));
    assert.equal(t1.data.studentName, "Ada Obi");
    assert.equal(t1.data.className, `${marker} JSS 2 Amber`);
    assert.equal(t1.data.time, "07:30");
    assert.match(t1.data.message, /Welcome, Ada/);
    const again = await call("/kiosk/tap", auth, { cardId: adaCard, tappedAt: at("07:30"), tapId: `${marker}-t2` });
    assert.equal(again.data.repeat, true);
    assert.equal(again.data.result, "present");
    const second = await call("/kiosk/tap", auth, { cardId: adaCard, tappedAt: at("09:10"), tapId: `${marker}-t3` });
    assert.equal(second.data.result, "already");
    const [adaRow] = await db.select().from(portalAttendance).where(and(eq(portalAttendance.studentId, ada.id), eq(portalAttendance.date, day)));
    assert.equal(adaRow.status, "present");
    assert.equal(adaRow.classId, classId);
    assert.match(adaRow.note, /Tapped in at 07:30/);
    assert.equal(adaRow.markedBy, `Card tap: ${marker} Main gate`);
    assert.equal((await db.select().from(tapEvents).where(and(eq(tapEvents.kioskId, kiosk.id), eq(tapEvents.tapRef, `${marker}-t2`)))).length, 1);

    // A teacher marked Bayo absent; he arrives at 08:20: late. A teacher's "excused" is never changed.
    await db.insert(portalAttendance).values({ classId, studentId: bayo.id, date: day, status: "absent", markedBy: teacher });
    const late = await call("/kiosk/tap", auth, { cardId: bayoCard, tappedAt: at("08:20") });
    assert.equal(late.data.result, "late");
    assert.match(late.data.message, /late/);
    const day2 = addDays(day, -1);
    await db.insert(portalAttendance).values({ classId, studentId: bayo.id, date: day2, status: "excused", markedBy: teacher });
    const exc = await call("/kiosk/tap", auth, { cardId: bayoCard, tappedAt: `${day2}T07:00:00+01:00` });
    assert.equal(exc.data.result, "already");
    assert.equal(exc.data.status, "excused");

    // Several taps sent together; an inactive student and a school ID instead of a card.
    await db.insert(tapCards).values({ cardId: `${adaCard}9`, studentId: gone.id });
    const batch = await call("/kiosk/tap", auth, { taps: [{ cardId: `${adaCard}9` }, { studentId: `${marker}-2`.toLowerCase(), tappedAt: at("10:00") }, "nonsense", {}] });
    assert.equal(batch.status, 200);
    assert.deepEqual(batch.data.results.map((r: { result: string }) => r.result), ["inactive", "already", "refused", "refused"]);
    assert.equal((await call("/kiosk/tap", auth, { taps: new Array(501).fill({ cardId: "AA11" }) })).status, 413);

    // Today's numbers and the log for the office.
    ov = await staff();
    assert.ok(ov.data.recent.some((e: { studentName: string | null; result: string }) => e.studentName === "Ada Obi" && e.result === "present"));
    assert.ok(ov.data.cards.some((c: { cardId: string; studentName: string }) => c.cardId === adaCard && c.studentName === "Ada Obi"));

    // Turned off: refused. New key: the old one stops working.
    assert.equal((await staff({ action: "setKioskActive", kioskId: kiosk.id, active: false })).status, 200);
    assert.equal((await call("/kiosk/tap", auth, { cardId: adaCard })).status, 403);
    await staff({ action: "setKioskActive", kioskId: kiosk.id, active: true });
    const fresh = await staff({ action: "newKioskKey", kioskId: kiosk.id });
    assert.equal((await call("/kiosk/ping", auth)).status, 401);
    assert.equal((await call("/kiosk/ping", { "X-Kiosk-Key": fresh.data.key })).status, 200);

    // Removing a card and the kiosk; marks already made stay.
    const cardRow = ov.data.cards.find((c: { cardId: string }) => c.cardId === bayoCard);
    assert.equal((await staff({ action: "removeCard", cardRowId: cardRow.id })).status, 200);
    assert.equal((await call("/kiosk/tap", { "X-Kiosk-Key": fresh.data.key }, { cardId: bayoCard, tappedAt: at("07:00") })).data.result, "unknown_card");
    assert.equal((await staff({ action: "deleteKiosk", kioskId: kiosk.id })).status, 200);
    assert.equal((await db.select().from(portalAttendance).where(and(eq(portalAttendance.studentId, ada.id), eq(portalAttendance.date, day)))).length, 1);
  } finally {
    server.close();
    const ids = (await db.select({ id: portalStudents.id }).from(portalStudents).where(like(portalStudents.studentId, `${marker}%`))).map((s) => s.id);
    if (kioskIds.length) await db.delete(tapEvents).where(inArray(tapEvents.kioskId, kioskIds));
    await db.delete(tapEvents).where(like(tapEvents.kioskName, `${marker}%`));
    await db.delete(tapKiosks).where(like(tapKiosks.name, `${marker}%`));
    if (ids.length) {
      await db.delete(tapCards).where(inArray(tapCards.studentId, ids));
      await db.delete(portalAttendance).where(inArray(portalAttendance.studentId, ids));
      await db.delete(portalStudents).where(inArray(portalStudents.id, ids));
    }
    if (classId) await db.delete(portalClasses).where(eq(portalClasses.id, classId));
    if (setting) await db.update(tapSettings).set({ lateAfter: setting.lateAfter }).where(eq(tapSettings.id, 1));
    else await db.delete(tapSettings).where(eq(tapSettings.id, 1));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await pool.end();
  }
});
