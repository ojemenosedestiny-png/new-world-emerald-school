import {
  CreateClassFeeScheduleBody,
  CreateClassFeeScheduleResponse,
  CreateIndividualFeeChargeBody,
  CreateIndividualFeeChargeResponse,
  CreateStoreProductBody,
  CreateStoreProductResponse,
  DeleteClassFeeScheduleParams,
  DeleteClassFeeScheduleResponse,
  DeleteIndividualFeeChargeParams,
  DeleteIndividualFeeChargeResponse,
  DeleteStoreProductParams,
  DeleteStoreProductResponse,
  GetSchoolCommerceSettingsResponse,
  ListClassFeeSchedulesResponse,
  ListIndividualFeeChargesResponse,
  ListManagedClassFeeSchedulesResponse,
  ListManagedStoreProductsResponse,
  ListStoreProductsResponse,
  LookupIndividualFeeChargeParams,
  LookupIndividualFeeChargeResponse,
  UpdateClassFeeScheduleBody,
  UpdateClassFeeScheduleParams,
  UpdateClassFeeScheduleResponse,
  UpdateIndividualFeeChargeBody,
  UpdateIndividualFeeChargeParams,
  UpdateIndividualFeeChargeResponse,
  UpdateSchoolCommerceSettingsBody,
  UpdateSchoolCommerceSettingsResponse,
  UpdateStoreProductBody,
  UpdateStoreProductParams,
  UpdateStoreProductResponse,
} from "@workspace/api-zod";
import {
  classFeeSchedulesTable,
  db,
  individualFeeChargesTable,
  schoolCommerceSettingsTable,
  storeProductsTable,
} from "@workspace/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuthentication } from "../lib/requireAuthentication";

const router: IRouter = Router();

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

router.get("/school-commerce/products", async (_req: Request, res: Response): Promise<void> => {
  const products = await db
    .select()
    .from(storeProductsTable)
    .where(eq(storeProductsTable.isActive, true))
    .orderBy(asc(storeProductsTable.category), asc(storeProductsTable.title));
  res.json(ListStoreProductsResponse.parse(products));
});

router.get(
  "/school-commerce/management/products",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const products = await db
      .select()
      .from(storeProductsTable)
      .orderBy(asc(storeProductsTable.category), asc(storeProductsTable.title));
    res.json(ListManagedStoreProductsResponse.parse(products));
  },
);

router.post(
  "/school-commerce/products",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const parsed = CreateStoreProductBody.safeParse(req.body);
    if (!parsed.success || !parsed.data.title.trim()) {
      res.status(400).json({ error: "Enter a product name and valid product details." });
      return;
    }
    const [created] = await db
      .insert(storeProductsTable)
      .values({
        ...parsed.data,
        title: parsed.data.title.trim(),
        description: parsed.data.description.trim(),
        variant: parsed.data.variant.trim(),
        imageUrl: parsed.data.imageUrl?.trim() || null,
      })
      .returning();
    res.status(201).json(CreateStoreProductResponse.parse(created));
  },
);

router.patch(
  "/school-commerce/products/:id",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const params = UpdateStoreProductParams.safeParse(req.params);
    const body = UpdateStoreProductBody.safeParse(req.body);
    if (!params.success || !body.success || (body.data.title !== undefined && !body.data.title.trim())) {
      res.status(400).json({ error: "Enter valid product details." });
      return;
    }
    const updates = {
      ...body.data,
      ...(body.data.title !== undefined ? { title: body.data.title.trim() } : {}),
      ...(body.data.description !== undefined ? { description: body.data.description.trim() } : {}),
      ...(body.data.variant !== undefined ? { variant: body.data.variant.trim() } : {}),
      ...(body.data.imageUrl !== undefined ? { imageUrl: body.data.imageUrl?.trim() || null } : {}),
    };
    const [updated] = await db
      .update(storeProductsTable)
      .set(updates)
      .where(eq(storeProductsTable.id, params.data.id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    res.json(UpdateStoreProductResponse.parse(updated));
  },
);

router.delete(
  "/school-commerce/products/:id",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const params = DeleteStoreProductParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid product id." });
      return;
    }
    const [deleted] = await db
      .delete(storeProductsTable)
      .where(eq(storeProductsTable.id, params.data.id))
      .returning({ id: storeProductsTable.id });
    if (!deleted) {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    res.json(DeleteStoreProductResponse.parse(undefined));
  },
);

router.get("/school-commerce/fee-schedules", async (_req: Request, res: Response): Promise<void> => {
  const schedules = await db
    .select()
    .from(classFeeSchedulesTable)
    .where(eq(classFeeSchedulesTable.isActive, true))
    .orderBy(asc(classFeeSchedulesTable.academicYear), asc(classFeeSchedulesTable.term), asc(classFeeSchedulesTable.className));
  res.json(ListClassFeeSchedulesResponse.parse(schedules));
});

router.get(
  "/school-commerce/management/fee-schedules",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const schedules = await db
      .select()
      .from(classFeeSchedulesTable)
      .orderBy(desc(classFeeSchedulesTable.academicYear), asc(classFeeSchedulesTable.term), asc(classFeeSchedulesTable.className));
    res.json(ListManagedClassFeeSchedulesResponse.parse(schedules));
  },
);

router.post(
  "/school-commerce/fee-schedules",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const parsed = CreateClassFeeScheduleBody.safeParse(req.body);
    if (
      !parsed.success ||
      !parsed.data.className.trim() ||
      !parsed.data.term.trim() ||
      !parsed.data.academicYear.trim()
    ) {
      res.status(400).json({ error: "Enter a class, term, academic year, and fee amount." });
      return;
    }
    try {
      const [created] = await db
        .insert(classFeeSchedulesTable)
        .values({
          ...parsed.data,
          className: parsed.data.className.trim(),
          term: parsed.data.term.trim(),
          academicYear: parsed.data.academicYear.trim(),
          description: parsed.data.description.trim(),
        })
        .returning();
      res.status(201).json(CreateClassFeeScheduleResponse.parse(created));
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "A fee schedule already exists for that class, term, and year." });
        return;
      }
      throw error;
    }
  },
);

router.patch(
  "/school-commerce/fee-schedules/:id",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const params = UpdateClassFeeScheduleParams.safeParse(req.params);
    const body = UpdateClassFeeScheduleBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Enter valid class fee details." });
      return;
    }
    const updates = {
      ...body.data,
      ...(body.data.className !== undefined ? { className: body.data.className.trim() } : {}),
      ...(body.data.term !== undefined ? { term: body.data.term.trim() } : {}),
      ...(body.data.academicYear !== undefined ? { academicYear: body.data.academicYear.trim() } : {}),
      ...(body.data.description !== undefined ? { description: body.data.description.trim() } : {}),
    };
    if (
      (updates.className !== undefined && !updates.className) ||
      (updates.term !== undefined && !updates.term) ||
      (updates.academicYear !== undefined && !updates.academicYear)
    ) {
      res.status(400).json({ error: "Class, term, and academic year cannot be blank." });
      return;
    }
    try {
      const [updated] = await db
        .update(classFeeSchedulesTable)
        .set(updates)
        .where(eq(classFeeSchedulesTable.id, params.data.id))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Fee schedule not found." });
        return;
      }
      res.json(UpdateClassFeeScheduleResponse.parse(updated));
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "A fee schedule already exists for that class, term, and year." });
        return;
      }
      throw error;
    }
  },
);

router.delete(
  "/school-commerce/fee-schedules/:id",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const params = DeleteClassFeeScheduleParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid fee schedule id." });
      return;
    }
    const [deleted] = await db
      .delete(classFeeSchedulesTable)
      .where(eq(classFeeSchedulesTable.id, params.data.id))
      .returning({ id: classFeeSchedulesTable.id });
    if (!deleted) {
      res.status(404).json({ error: "Fee schedule not found." });
      return;
    }
    res.json(DeleteClassFeeScheduleResponse.parse(undefined));
  },
);

router.get(
  "/school-commerce/management/individual-charges",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const charges = await db
      .select()
      .from(individualFeeChargesTable)
      .orderBy(desc(individualFeeChargesTable.createdAt));
    res.json(ListIndividualFeeChargesResponse.parse(charges));
  },
);

router.post(
  "/school-commerce/individual-charges",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const parsed = CreateIndividualFeeChargeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter all student, term, description, and amount details." });
      return;
    }
    const [created] = await db
      .insert(individualFeeChargesTable)
      .values({
        ...parsed.data,
        reference: `NWE-CHG-${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`,
        studentName: parsed.data.studentName.trim(),
        studentIdentifier: parsed.data.studentIdentifier.trim(),
        className: parsed.data.className.trim(),
        term: parsed.data.term.trim(),
        academicYear: parsed.data.academicYear.trim(),
        description: parsed.data.description.trim(),
      })
      .returning();
    res.status(201).json(CreateIndividualFeeChargeResponse.parse(created));
  },
);

router.get(
  "/school-commerce/individual-charges/lookup/:reference",
  async (req: Request, res: Response): Promise<void> => {
    const params = LookupIndividualFeeChargeParams.safeParse(req.params);
    if (!params.success) {
      res.status(404).json({ error: "Fee reference not found." });
      return;
    }
    const [charge] = await db
      .select({
        reference: individualFeeChargesTable.reference,
        className: individualFeeChargesTable.className,
        term: individualFeeChargesTable.term,
        academicYear: individualFeeChargesTable.academicYear,
        description: individualFeeChargesTable.description,
        amountKobo: individualFeeChargesTable.amountKobo,
        status: individualFeeChargesTable.status,
      })
      .from(individualFeeChargesTable)
      .where(eq(individualFeeChargesTable.reference, params.data.reference));
    if (!charge) {
      res.status(404).json({ error: "Fee reference not found." });
      return;
    }
    res.json(LookupIndividualFeeChargeResponse.parse(charge));
  },
);

router.patch(
  "/school-commerce/individual-charges/:id",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const params = UpdateIndividualFeeChargeParams.safeParse(req.params);
    const body = UpdateIndividualFeeChargeBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Enter valid individual fee charge details." });
      return;
    }
    const updates = {
      ...body.data,
      ...(body.data.studentName !== undefined ? { studentName: body.data.studentName.trim() } : {}),
      ...(body.data.studentIdentifier !== undefined
        ? { studentIdentifier: body.data.studentIdentifier.trim() }
        : {}),
      ...(body.data.className !== undefined ? { className: body.data.className.trim() } : {}),
      ...(body.data.term !== undefined ? { term: body.data.term.trim() } : {}),
      ...(body.data.academicYear !== undefined ? { academicYear: body.data.academicYear.trim() } : {}),
      ...(body.data.description !== undefined ? { description: body.data.description.trim() } : {}),
    };
    const [updated] = await db
      .update(individualFeeChargesTable)
      .set(updates)
      .where(eq(individualFeeChargesTable.id, params.data.id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Individual fee charge not found." });
      return;
    }
    res.json(UpdateIndividualFeeChargeResponse.parse(updated));
  },
);

router.delete(
  "/school-commerce/individual-charges/:id",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const params = DeleteIndividualFeeChargeParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid individual fee charge id." });
      return;
    }
    const [cancelled] = await db
      .update(individualFeeChargesTable)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(individualFeeChargesTable.id, params.data.id),
          eq(individualFeeChargesTable.status, "due"),
        ),
      )
      .returning({ id: individualFeeChargesTable.id });
    if (!cancelled) {
      res.status(404).json({ error: "Due individual fee charge not found." });
      return;
    }
    res.json(DeleteIndividualFeeChargeResponse.parse(undefined));
  },
);

router.get("/school-commerce/settings", async (_req: Request, res: Response): Promise<void> => {
  const [settings] = await db
    .select()
    .from(schoolCommerceSettingsTable)
    .where(eq(schoolCommerceSettingsTable.id, "school"));
  res.json(
    GetSchoolCommerceSettingsResponse.parse(
      settings ?? { paymentInstructions: "", updatedAt: new Date() },
    ),
  );
});

router.put(
  "/school-commerce/settings",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const parsed = UpdateSchoolCommerceSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter valid payment instructions." });
      return;
    }
    const [settings] = await db
      .insert(schoolCommerceSettingsTable)
      .values({ id: "school", paymentInstructions: parsed.data.paymentInstructions.trim() })
      .onConflictDoUpdate({
        target: schoolCommerceSettingsTable.id,
        set: { paymentInstructions: parsed.data.paymentInstructions.trim() },
      })
      .returning();
    res.json(UpdateSchoolCommerceSettingsResponse.parse(settings));
  },
);

export default router;