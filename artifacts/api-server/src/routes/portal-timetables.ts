import { Router, type Request } from "express";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db, portalClasses, portalFiles, portalTimetables, type PortalTimetableRecord } from "@workspace/db";
import { ManageTimetablesBody } from "@workspace/api-zod";
import { check, portalActor, studentOnly, type PortalActor } from "../lib/portal-auth";
import { canPublishExams } from "../lib/website-admin";
import { diagramContentType } from "../lib/portal-pdf";

/**
 * Class and exam timetables. The office and the exam officer post them for the whole school or chosen classes; a
 * teacher posts them for their own classes. Students and parents see the published ones for their class.
 */
export const portalTimetablesRouter = Router();

const NOBODY: PortalActor = { role: "guest", name: "", classIds: [], mustChangePassword: false };

async function poster(req: Request) {
  // The exam officer posts for the whole school without needing a staff record.
  if (canPublishExams(req)) return { actor: NOBODY, all: true, by: req.identity?.email ?? "Exam officer" };
  const actor = await portalActor(req);
  const all = actor.role === "admin";
  check(all || actor.role === "teacher", "Sign in as staff to manage timetables.", actor.role === "guest" ? 401 : 403);
  return { actor, all, by: req.identity?.email ?? actor.name };
}

const visibleTo = (t: PortalTimetableRecord, all: boolean, actor: PortalActor) => all || !t.classIds.length || t.classIds.some((id) => actor.classIds.includes(id));

/** Timetables as the portal shows them: class names, and whether the file is a PDF or a picture. */
export async function timetableViews(rows: PortalTimetableRecord[]) {
  const ids = [...new Set(rows.flatMap((r) => r.classIds))];
  const names = new Map(ids.length ? (await db.select({ id: portalClasses.id, name: portalClasses.name }).from(portalClasses).where(inArray(portalClasses.id, ids))).map((c) => [c.id, c.name]) : []);
  const files = rows.length ? await db.select({ id: portalFiles.id, objectName: portalFiles.objectName }).from(portalFiles).where(inArray(portalFiles.id, rows.map((r) => r.fileId))) : [];
  return rows.map((r) => ({
    id: r.id, title: r.title, kind: r.kind as "exam" | "class", classIds: r.classIds, classNames: r.classIds.map((id) => names.get(id) ?? "").filter(Boolean),
    fileId: r.fileId, fileType: diagramContentType(files.find((f) => f.id === r.fileId)?.objectName ?? "") ? "image" as const : "pdf" as const,
    published: r.published, createdBy: r.createdBy, updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Published timetables for one class and the whole school, exam timetables first, newest first. */
export async function timetablesForClass(classId: number) {
  const rows = (await db.select().from(portalTimetables).where(eq(portalTimetables.published, true)).orderBy(desc(portalTimetables.updatedAt)))
    .filter((t) => !t.classIds.length || t.classIds.includes(classId))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "exam" ? -1 : 1));
  return timetableViews(rows);
}

portalTimetablesRouter.get("/timetables", async (req, res) => {
  const { actor, all } = await poster(req);
  const [rows, classes] = await Promise.all([
    db.select().from(portalTimetables).orderBy(desc(portalTimetables.updatedAt)),
    db.select({ id: portalClasses.id, name: portalClasses.name }).from(portalClasses).orderBy(asc(portalClasses.name)),
  ]);
  res.json({ canWholeSchool: all, classes: all ? classes : classes.filter((c) => actor.classIds.includes(c.id)), timetables: await timetableViews(rows.filter((t) => visibleTo(t, all, actor))) });
});

portalTimetablesRouter.post("/timetables", async (req, res) => {
  const { actor, all, by } = await poster(req);
  const body = ManageTimetablesBody.parse(req.body);
  const mayChange = (t: PortalTimetableRecord) => all || (t.classIds.length > 0 && t.classIds.every((id) => actor.classIds.includes(id)));
  if (body.action === "delete") {
    check(body.id, "Choose a timetable.");
    const [t] = await db.select().from(portalTimetables).where(eq(portalTimetables.id, body.id));
    check(t, "Timetable not found.", 404);
    check(mayChange(t), "Only the school office, the exam officer or the class's own teacher can remove this timetable.", 403);
    await db.delete(portalTimetables).where(eq(portalTimetables.id, t.id));
    res.json({ message: `"${t.title}" is removed.` });
    return;
  }
  const input = body.timetable;
  check(input, "Timetable details required.");
  const title = input.title.trim();
  check(title, "Give the timetable a title, such as \"Autumn Term exam timetable\".");
  const classIds = [...new Set(input.classIds)];
  check(classIds.length || all, "Choose your classes. Only the school office or the exam officer can post for the whole school.", 403);
  check(all || classIds.every((id) => actor.classIds.includes(id)), "You can only post timetables for your own classes.", 403);
  if (classIds.length) check((await db.select({ id: portalClasses.id }).from(portalClasses).where(inArray(portalClasses.id, classIds))).length === classIds.length, "A class was not found.", 404);
  const [file] = await db.select().from(portalFiles).where(eq(portalFiles.id, input.fileId));
  check(file, "Upload the timetable file first.");
  check(all || (file.classId !== null && classIds.includes(file.classId)), "Upload the timetable for one of the chosen classes.", 403);
  const values = { title, kind: input.kind, classIds, fileId: file.id, published: input.published, updatedAt: new Date() };
  if (input.id) {
    const [old] = await db.select().from(portalTimetables).where(eq(portalTimetables.id, input.id));
    check(old, "Timetable not found.", 404);
    check(mayChange(old), "Only the school office, the exam officer or the class's own teacher can change this timetable.", 403);
    await db.update(portalTimetables).set(values).where(eq(portalTimetables.id, old.id));
  } else await db.insert(portalTimetables).values({ ...values, createdBy: by });
  res.json({ message: input.published ? `"${title}" is posted. Students${classIds.length ? " in the chosen classes" : ""} and their parents can open it.` : `"${title}" is saved as hidden.` });
});

portalTimetablesRouter.get("/my-timetables", async (req, res) => {
  const student = studentOnly(await portalActor(req));
  res.json(await timetablesForClass(student.classId));
});
