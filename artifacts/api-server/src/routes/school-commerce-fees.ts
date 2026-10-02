import {
  ListFeePaymentReportsResponse,
  SubmitFeePaymentReportBody,
  SubmitFeePaymentReportResponse,
  UpdateFeePaymentReportBody,
  UpdateFeePaymentReportParams,
  UpdateFeePaymentReportResponse,
} from "@workspace/api-zod";
import {
  classFeeSchedulesTable,
  db,
  feePaymentReportsTable,
  individualFeeChargesTable,
} from "@workspace/db";
import { and, desc, eq, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuthentication } from "../lib/requireAuthentication";

const router: IRouter = Router();

function normalizeIdentifier(value: string): string {
  return value.trim().toLocaleUpperCase().replace(/\s+/g, "");
}

function cleanTransferReference(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

router.post(
  "/school-commerce/fee-reports",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = SubmitFeePaymentReportBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Complete the student and parent payment details." });
      return;
    }

    let scheduleId: number | null = null;
    let chargeId: number | null = null;
    let studentName = parsed.data.studentName.trim();
    let studentIdentifier = parsed.data.studentIdentifier.trim();
    let className = parsed.data.className?.trim() ?? "";
    let term = parsed.data.term?.trim() ?? "";
    let academicYear = parsed.data.academicYear?.trim() ?? "";
    let description = "";
    let amountKobo = 0;

    if (parsed.data.feeType === "class_fee") {
      if (!parsed.data.scheduleId) {
        res.status(400).json({ error: "Choose an active class fee schedule." });
        return;
      }
      const [schedule] = await db
        .select()
        .from(classFeeSchedulesTable)
        .where(
          and(
            eq(classFeeSchedulesTable.id, parsed.data.scheduleId),
            eq(classFeeSchedulesTable.isActive, true),
          ),
        );
      if (!schedule) {
        res.status(404).json({ error: "The selected class fee is no longer available." });
        return;
      }
      scheduleId = schedule.id;
      className = schedule.className;
      term = schedule.term;
      academicYear = schedule.academicYear;
      description = schedule.description;
      amountKobo = schedule.amountKobo;
    } else {
      const reference = parsed.data.chargeReference?.trim();
      if (!reference) {
        res.status(400).json({ error: "Enter the individual charge reference supplied by the School Office." });
        return;
      }
      const [charge] = await db
        .select()
        .from(individualFeeChargesTable)
        .where(eq(individualFeeChargesTable.reference, reference));
      if (!charge) {
        res.status(404).json({ error: "The individual fee reference was not found." });
        return;
      }
      if (charge.status !== "due") {
        res.status(409).json({ error: "This individual fee charge is no longer payable." });
        return;
      }
      if (normalizeIdentifier(parsed.data.studentIdentifier) !== normalizeIdentifier(charge.studentIdentifier)) {
        res.status(404).json({ error: "The student details do not match this fee reference." });
        return;
      }
      const pendingReport = await db
        .select({ id: feePaymentReportsTable.id })
        .from(feePaymentReportsTable)
        .where(
          and(
            eq(feePaymentReportsTable.chargeId, charge.id),
            or(
              eq(feePaymentReportsTable.status, "payment_requested"),
              eq(feePaymentReportsTable.status, "reported"),
            ),
          ),
        )
        .limit(1);
      if (pendingReport.length > 0) {
        res.status(409).json({ error: "A payment request for this charge is already awaiting School Office review." });
        return;
      }
      if (normalizeIdentifier(studentName) !== normalizeIdentifier(charge.studentName)) {
        res.status(404).json({ error: "The student details do not match this fee reference." });
        return;
      }
      chargeId = charge.id;
      studentName = charge.studentName;
      studentIdentifier = charge.studentIdentifier;
      className = charge.className;
      term = charge.term;
      academicYear = charge.academicYear;
      description = charge.description;
      amountKobo = charge.amountKobo;
    }

    const transferReference = cleanTransferReference(parsed.data.transferReference);
    const [created] = await db
      .insert(feePaymentReportsTable)
      .values({
        reference: `NWE-FEE-${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`,
        feeType: parsed.data.feeType,
        scheduleId,
        chargeId,
        studentName,
        studentIdentifier,
        className,
        term,
        academicYear,
        description,
        amountKobo,
        guardianName: parsed.data.guardianName.trim(),
        guardianEmail: parsed.data.guardianEmail.trim(),
        guardianPhone: parsed.data.guardianPhone.trim(),
        transferReference,
        status: transferReference ? "reported" : "payment_requested",
      })
      .returning();

    res.status(201).json(
      SubmitFeePaymentReportResponse.parse({
        reference: created.reference,
        amountKobo: created.amountKobo,
        status: created.status,
      }),
    );
  },
);

router.get(
  "/school-commerce/fee-reports",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const reports = await db
      .select()
      .from(feePaymentReportsTable)
      .orderBy(desc(feePaymentReportsTable.createdAt));
    res.json(ListFeePaymentReportsResponse.parse(reports));
  },
);

router.patch(
  "/school-commerce/fee-reports/:id",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const params = UpdateFeePaymentReportParams.safeParse(req.params);
    const body = UpdateFeePaymentReportBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Enter a valid payment status or office note." });
      return;
    }
    const [current] = await db
      .select()
      .from(feePaymentReportsTable)
      .where(eq(feePaymentReportsTable.id, params.data.id));
    if (!current) {
      res.status(404).json({ error: "Fee payment report not found." });
      return;
    }
    if (current.status === "confirmed" && body.data.status && body.data.status !== "confirmed") {
      res.status(400).json({ error: "A confirmed payment cannot be changed from the dashboard." });
      return;
    }

    const updates = {
      ...body.data,
      ...(body.data.officeNote !== undefined
        ? { officeNote: body.data.officeNote?.trim() || null }
        : {}),
    };
    const updated = await db.transaction(async (tx) => {
      const [report] = await tx
        .update(feePaymentReportsTable)
        .set(updates)
        .where(eq(feePaymentReportsTable.id, params.data.id))
        .returning();
      if (body.data.status === "confirmed" && report.chargeId !== null) {
        await tx
          .update(individualFeeChargesTable)
          .set({ status: "paid" })
          .where(eq(individualFeeChargesTable.id, report.chargeId));
      }
      if (body.data.status === "rejected" && report.chargeId !== null) {
        await tx
          .update(individualFeeChargesTable)
          .set({ status: "due" })
          .where(eq(individualFeeChargesTable.id, report.chargeId));
      }
      return report;
    });
    res.json(UpdateFeePaymentReportResponse.parse(updated));
  },
);

export default router;