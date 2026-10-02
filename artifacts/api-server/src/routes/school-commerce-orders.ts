import {
  CreateStoreOrderBody,
  CreateStoreOrderResponse,
  ListStoreOrdersResponse,
  UpdateStoreOrderBody,
  UpdateStoreOrderParams,
  UpdateStoreOrderResponse,
} from "@workspace/api-zod";
import { db, storeOrdersTable, storeProductsTable } from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuthentication } from "../lib/requireAuthentication";

const router: IRouter = Router();

function isNonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

router.post(
  "/school-commerce/orders",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateStoreOrderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Complete the parent, student, and order details." });
      return;
    }

    const quantities = new Map<number, number>();
    for (const item of parsed.data.items) {
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    }
    if ([...quantities.values()].some((quantity) => quantity > 20)) {
      res.status(400).json({ error: "The maximum quantity per product is 20." });
      return;
    }

    const productIds = [...quantities.keys()];
    const products = await db
      .select()
      .from(storeProductsTable)
      .where(inArray(storeProductsTable.id, productIds));
    if (
      products.length !== productIds.length ||
      products.some((product) => !product.isActive)
    ) {
      res.status(409).json({ error: "One or more selected products are no longer available." });
      return;
    }
    if (
      products.some((product) => {
        const requestedQuantity = quantities.get(product.id) ?? 0;
        return product.stock !== null && requestedQuantity > product.stock;
      })
    ) {
      res.status(409).json({ error: "The requested quantity exceeds current availability." });
      return;
    }

    const items = products.map((product) => {
      const quantity = quantities.get(product.id) ?? 0;
      return {
        productId: product.id,
        title: product.title,
        variant: product.variant,
        quantity,
        unitPriceKobo: product.priceKobo,
        lineTotalKobo: product.priceKobo * quantity,
      };
    });
    const totalKobo = items.reduce((total, item) => total + item.lineTotalKobo, 0);
    if (!Number.isSafeInteger(totalKobo) || totalKobo < 1) {
      res.status(400).json({ error: "The order total is invalid." });
      return;
    }
    const transferReference = isNonEmpty(parsed.data.transferReference);
    const [created] = await db
      .insert(storeOrdersTable)
      .values({
        reference: `NWE-ORD-${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`,
        guardianName: parsed.data.guardianName.trim(),
        guardianEmail: parsed.data.guardianEmail.trim(),
        guardianPhone: parsed.data.guardianPhone.trim(),
        studentName: parsed.data.studentName.trim(),
        studentClass: parsed.data.studentClass.trim(),
        items,
        totalKobo,
        orderNotes: parsed.data.orderNotes?.trim() ?? "",
        transferReference,
        paymentStatus: transferReference ? "reported" : "awaiting_payment",
      })
      .returning();

    res.status(201).json(
      CreateStoreOrderResponse.parse({
        reference: created.reference,
        totalKobo: created.totalKobo,
        orderStatus: created.orderStatus,
        paymentStatus: created.paymentStatus,
      }),
    );
  },
);

router.get(
  "/school-commerce/orders",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const orders = await db
      .select()
      .from(storeOrdersTable)
      .orderBy(desc(storeOrdersTable.createdAt));
    res.json(ListStoreOrdersResponse.parse(orders));
  },
);

router.patch(
  "/school-commerce/orders/:id",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const params = UpdateStoreOrderParams.safeParse(req.params);
    const body = UpdateStoreOrderBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Enter valid order status or notes." });
      return;
    }

    const [current] = await db
      .select()
      .from(storeOrdersTable)
      .where(eq(storeOrdersTable.id, params.data.id));
    if (!current) {
      res.status(404).json({ error: "Order not found." });
      return;
    }

    const paymentStatus = body.data.paymentStatus ?? current.paymentStatus;
    const orderStatus = body.data.orderStatus ?? current.orderStatus;
    if (orderStatus === "completed" && paymentStatus !== "confirmed") {
      res.status(400).json({ error: "Confirm payment before completing this order." });
      return;
    }

    const updates = {
      ...body.data,
      ...(body.data.transferReference !== undefined
        ? { transferReference: isNonEmpty(body.data.transferReference) }
        : {}),
      ...(body.data.officeNote !== undefined
        ? { officeNote: body.data.officeNote?.trim() || null }
        : {}),
    };
    const [updated] = await db
      .update(storeOrdersTable)
      .set(updates)
      .where(eq(storeOrdersTable.id, params.data.id))
      .returning();
    res.json(UpdateStoreOrderResponse.parse(updated));
  },
);

export default router;