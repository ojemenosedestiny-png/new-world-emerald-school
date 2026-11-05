import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
import { SCHOOL_TERMS } from "./term-names";

/**
 * Moves saved records from First, Second and Third Term to Autumn, Spring and Summer Term. Safe on every start: once
 * renamed there is nothing left to match, and a record is left alone if the new name already exists beside it.
 * Past payments keep the wording on their receipts. A failure is logged and never stops the site starting.
 */
export async function renameSchoolTerms() {
  for (const { old, name } of SCHOOL_TERMS) {
    try {
      await db.execute(sql`update portal_terms t set term = ${name} where t.term = ${old}
        and not exists (select 1 from portal_terms o where o.session = t.session and o.term = ${name})`);
      await db.execute(sql`update class_fee_schedules t set term = ${name} where t.term = ${old}
        and not exists (select 1 from class_fee_schedules o where o.class_name = t.class_name and o.academic_year = t.academic_year and o.term = ${name})`);
      await db.execute(sql`update individual_fee_charges set term = ${name} where term = ${old}`);
      await db.execute(sql`update fee_payment_reports set term = ${name} where term = ${old}`);
    } catch (error) {
      logger.error({ err: error, term: old }, "School term rename failed");
    }
  }
}
