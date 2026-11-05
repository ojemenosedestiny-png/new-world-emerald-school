import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { classFeeSchedulesTable, db, individualFeeChargesTable, pool, portalTerms } from "@workspace/db";
import { renameSchoolTerms } from "./rename-terms";

// Database checks for moving saved records to Autumn, Spring and Summer Term.
test("term rename: old names move to the new ones, safely and repeatably", async () => {
  const marker = `QA-TRM-${randomUUID().slice(0, 8)}`.toUpperCase();
  const termIds: number[] = [];
  try {
    const terms = await db.insert(portalTerms).values([
      { session: "2081/2082", term: "First Term" }, { session: "2081/2082", term: "Third Term" },
      // This session already has an Autumn Term, so its First Term is left alone rather than clash.
      { session: "2083/2084", term: "First Term" }, { session: "2083/2084", term: "Autumn Term" },
    ]).returning();
    termIds.push(...terms.map((t) => t.id));
    await db.insert(classFeeSchedulesTable).values([
      { className: `${marker} JSS 1`, term: "Second Term", academicYear: "2081/2082", amountKobo: 1000, description: "Tuition" },
      { className: `${marker} JSS 2`, term: "First Term", academicYear: "2081/2082", amountKobo: 1000, description: "Tuition" },
      { className: `${marker} JSS 2`, term: "Autumn Term", academicYear: "2081/2082", amountKobo: 1000, description: "Tuition" },
    ]);
    await db.insert(individualFeeChargesTable).values({ reference: `HOSTEL-2081-2082-FIRST-TERM-${marker}`, studentName: "Ada Obi", studentIdentifier: marker, className: "JSS 1", term: "First Term", academicYear: "2081/2082", description: "Hostel", amountKobo: 1000 });

    const names = async () => (await db.select().from(portalTerms).where(inArray(portalTerms.id, termIds))).map((t) => `${t.session} ${t.term}`).sort();
    await renameSchoolTerms();
    await renameSchoolTerms();
    assert.deepEqual(await names(), ["2081/2082 Autumn Term", "2081/2082 Summer Term", "2083/2084 Autumn Term", "2083/2084 First Term"]);
    const schedules = await db.select().from(classFeeSchedulesTable).where(like(classFeeSchedulesTable.className, `${marker}%`));
    assert.deepEqual(schedules.map((s) => `${s.className.slice(-5)} ${s.term}`).sort(), ["JSS 1 Spring Term", "JSS 2 Autumn Term", "JSS 2 First Term"]);
    const [charge] = await db.select().from(individualFeeChargesTable).where(eq(individualFeeChargesTable.studentIdentifier, marker));
    assert.equal(charge.term, "Autumn Term");
    assert.match(charge.reference, /FIRST-TERM/, "the charge keeps its reference, so it cannot be billed again");
  } finally {
    if (termIds.length) await db.delete(portalTerms).where(inArray(portalTerms.id, termIds));
    await db.delete(classFeeSchedulesTable).where(like(classFeeSchedulesTable.className, `${marker}%`));
    await db.delete(individualFeeChargesTable).where(eq(individualFeeChargesTable.studentIdentifier, marker));
    await pool.end();
  }
});
