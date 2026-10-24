import { Router, type Request } from "express";
import { asc, eq } from "drizzle-orm";
import { db, portalClasses, portalEvents, portalTeachers, type PortalEventRecord } from "@workspace/db";
import { CreatePortalEventBody, UpdatePortalEventBody } from "@workspace/api-zod";
import { check, portalActor } from "../lib/portal-auth";
import { directoryEntries, eventValues, eventVisible } from "../lib/community";

export const portalCommunityRouter = Router();

async function signedIn(req: Request) {
  const actor = await portalActor(req);
  check(actor.role !== "guest", "Sign in to continue.", 401);
  return actor;
}
async function adminOnly(req: Request) {
  const actor = await signedIn(req);
  check(actor.role === "admin", "Only school administrators can manage the calendar.", 403);
  return actor;
}
async function classNames() {
  return new Map((await db.select().from(portalClasses)).map((c) => [c.id, c.name]));
}
function view(e: PortalEventRecord, names: Map<number, string>) {
  return {
    id: e.id, title: e.title, details: e.details, venue: e.venue, category: e.category as "general",
    startsAt: e.startsAt.toISOString(), endsAt: e.endsAt?.toISOString() ?? null, allDay: e.allDay,
    classId: e.classId, className: e.classId === null ? null : names.get(e.classId) ?? null, published: e.published,
  };
}
async function parseEvent(body: unknown) {
  const result = eventValues(CreatePortalEventBody.parse(body));
  check(!("error" in result), "error" in result ? result.error : "");
  if (result.values.classId !== null) {
    const [row] = await db.select({ id: portalClasses.id }).from(portalClasses).where(eq(portalClasses.id, result.values.classId));
    check(row, "Class not found.", 404);
  }
  return result.values;
}

portalCommunityRouter.get("/events", async (req, res) => {
  const actor = await signedIn(req);
  const rows = await db.select().from(portalEvents).orderBy(asc(portalEvents.startsAt));
  const names = await classNames();
  res.json(rows.filter((e) => actor.role === "admin" || eventVisible(e, actor.classIds)).map((e) => view(e, names)));
});
portalCommunityRouter.post("/events", async (req, res) => {
  await adminOnly(req);
  const values = await parseEvent(req.body);
  const [row] = await db.insert(portalEvents).values({ ...values, createdBy: req.identity?.email ?? null }).returning();
  res.json(view(row, await classNames()));
});
portalCommunityRouter.put("/events/:id", async (req, res) => {
  await adminOnly(req);
  const id = Number(req.params.id);
  check(Number.isSafeInteger(id) && id > 0, "Invalid event.");
  UpdatePortalEventBody.parse(req.body);
  const values = await parseEvent(req.body);
  const [row] = await db.update(portalEvents).set(values).where(eq(portalEvents.id, id)).returning();
  check(row, "Event not found.", 404);
  res.json(view(row, await classNames()));
});
portalCommunityRouter.delete("/events/:id", async (req, res) => {
  await adminOnly(req);
  const [row] = await db.delete(portalEvents).where(eq(portalEvents.id, Number(req.params.id) || 0)).returning({ id: portalEvents.id });
  check(row, "Event not found.", 404);
  res.json({ message: "Event deleted." });
});
portalCommunityRouter.get("/staff-directory", async (req, res) => {
  await signedIn(req);
  res.json(directoryEntries(await db.select().from(portalTeachers), await classNames()));
});
