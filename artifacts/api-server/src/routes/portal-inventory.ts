import { Router, type Request } from "express";
import { asc, desc, eq } from "drizzle-orm";
import { db, portalClasses, portalInventoryItems, portalInventoryMoves, type PortalInventoryItemRecord } from "@workspace/db";
import { DeleteInventoryItemParams, ListInventoryMovesParams, RecordInventoryMoveBody, RecordInventoryMoveParams, SaveInventoryItemBody } from "@workspace/api-zod";
import { check, portalActor, staffOnly, type PortalActor } from "../lib/portal-auth";
import { DEFAULT_CATEGORIES, applyMove, itemProblem, stockStatus, teacherMayEdit, teacherMaySee, type MoveKind } from "../lib/inventory";

export const portalInventoryRouter = Router();

async function staff(req: Request) {
  const actor = await portalActor(req);
  staffOnly(actor);
  return actor;
}
const isAdmin = (a: PortalActor) => a.role === "admin";
const maySee = (a: PortalActor, item: { classId: number | null }) => isAdmin(a) || teacherMaySee(item, a.classIds);
const mayEdit = (a: PortalActor, item: { classId: number | null }) => isAdmin(a) || teacherMayEdit(item, a.classIds);
const who = (req: Request, a: PortalActor) => req.identity?.email || a.name;

async function classNames() {
  return new Map((await db.select({ id: portalClasses.id, name: portalClasses.name }).from(portalClasses)).map((c) => [c.id, c.name]));
}
function view(item: PortalInventoryItemRecord, actor: PortalActor, names: Map<number, string>) {
  return {
    id: item.id, name: item.name, category: item.category, location: item.location, unit: item.unit,
    quantity: item.quantity, reorderLevel: item.reorderLevel, condition: item.condition as "good",
    classId: item.classId, className: item.classId == null ? "" : names.get(item.classId) ?? "",
    notes: item.notes, status: stockStatus(item), canEdit: mayEdit(actor, item), updatedAt: item.updatedAt.toISOString(),
  };
}
async function visibleItem(actor: PortalActor, id: number) {
  const [item] = await db.select().from(portalInventoryItems).where(eq(portalInventoryItems.id, id));
  check(item && maySee(actor, item), "Item not found.", 404);
  return item;
}

portalInventoryRouter.get("/inventory", async (req, res) => {
  const actor = await staff(req);
  const [rows, names] = await Promise.all([db.select().from(portalInventoryItems).orderBy(asc(portalInventoryItems.category), asc(portalInventoryItems.name)), classNames()]);
  const items = rows.filter((i) => maySee(actor, i));
  const categories = [...new Set([...items.map((i) => i.category), ...DEFAULT_CATEGORIES])].sort((a, b) => a.localeCompare(b));
  res.json({ items: items.map((i) => view(i, actor, names)), categories, canDelete: isAdmin(actor) });
});

portalInventoryRouter.post("/inventory", async (req, res) => {
  const actor = await staff(req);
  const input = SaveInventoryItemBody.parse(req.body);
  const data = {
    name: input.name.trim(), category: input.category.trim(), location: input.location.trim(), unit: input.unit.trim() || "pieces",
    quantity: input.quantity, reorderLevel: input.reorderLevel, condition: input.condition, classId: input.classId ?? null, notes: input.notes.trim(),
  };
  const problem = itemProblem(data);
  check(!problem, problem ?? "");
  check(mayEdit(actor, data), "Teachers can add and edit items for their own classes. Ask the office to change school-wide stock.", 403);
  if (data.classId != null) {
    const [cls] = await db.select({ id: portalClasses.id }).from(portalClasses).where(eq(portalClasses.id, data.classId));
    check(cls, "Class not found.", 404);
  }
  const by = who(req, actor);
  const saved = await db.transaction(async (tx) => {
    if (input.id) {
      const [old] = await tx.select().from(portalInventoryItems).where(eq(portalInventoryItems.id, input.id)).for("update");
      check(old && maySee(actor, old), "Item not found.", 404);
      check(mayEdit(actor, old), "Only the school office can edit school-wide stock.", 403);
      // Stock only changes through recorded movements, so the history always adds up.
      const { quantity: _q, ...details } = data;
      const [row] = await tx.update(portalInventoryItems).set({ ...details, updatedAt: new Date() }).where(eq(portalInventoryItems.id, old.id)).returning();
      if (old.condition !== row.condition) await tx.insert(portalInventoryMoves).values({ itemId: row.id, kind: "condition", change: 0, quantityAfter: row.quantity, note: `Condition: ${row.condition.replace("_", " ")}`, actor: by });
      return row;
    }
    const [row] = await tx.insert(portalInventoryItems).values({ ...data, createdBy: by }).returning();
    await tx.insert(portalInventoryMoves).values({ itemId: row.id, kind: "count", change: row.quantity, quantityAfter: row.quantity, note: "Opening stock", actor: by });
    return row;
  });
  res.json(view(saved, actor, await classNames()));
});

portalInventoryRouter.delete("/inventory/:id", async (req, res) => {
  const actor = await staff(req);
  check(isAdmin(actor), "Only the school office can remove items.", 403);
  const { id } = DeleteInventoryItemParams.parse(req.params);
  const [gone] = await db.delete(portalInventoryItems).where(eq(portalInventoryItems.id, id)).returning({ id: portalInventoryItems.id });
  check(gone, "Item not found.", 404);
  res.status(204).end();
});

portalInventoryRouter.get("/inventory/:id/moves", async (req, res) => {
  const actor = await staff(req);
  const { id } = ListInventoryMovesParams.parse(req.params);
  await visibleItem(actor, id);
  const moves = await db.select().from(portalInventoryMoves).where(eq(portalInventoryMoves.itemId, id))
    .orderBy(desc(portalInventoryMoves.createdAt), desc(portalInventoryMoves.id)).limit(100);
  res.json(moves.map((m) => ({ id: m.id, kind: m.kind, change: m.change, quantityAfter: m.quantityAfter, note: m.note, actor: m.actor, createdAt: m.createdAt.toISOString() })));
});

portalInventoryRouter.post("/inventory/:id/moves", async (req, res) => {
  const actor = await staff(req);
  const { id } = RecordInventoryMoveParams.parse(req.params);
  const input = RecordInventoryMoveBody.parse(req.body);
  check(input.kind !== "condition" || input.condition, "Choose the item's condition.");
  const saved = await db.transaction(async (tx) => {
    const [item] = await tx.select().from(portalInventoryItems).where(eq(portalInventoryItems.id, id)).for("update");
    check(item && maySee(actor, item), "Item not found.", 404);
    const result = applyMove(item.quantity, input.kind as MoveKind, input.quantity);
    check(!("problem" in result), "problem" in result ? result.problem : "");
    const { change, after } = result as { change: number; after: number };
    const condition = input.condition ?? item.condition;
    const [row] = await tx.update(portalInventoryItems).set({ quantity: after, condition, updatedAt: new Date() }).where(eq(portalInventoryItems.id, item.id)).returning();
    const note = [input.note.trim(), input.condition && input.condition !== item.condition ? `Condition: ${input.condition.replace("_", " ")}` : ""].filter(Boolean).join(" · ");
    await tx.insert(portalInventoryMoves).values({ itemId: item.id, kind: input.kind, change, quantityAfter: after, note, actor: who(req, actor) });
    return row;
  });
  res.json(view(saved, actor, await classNames()));
});
