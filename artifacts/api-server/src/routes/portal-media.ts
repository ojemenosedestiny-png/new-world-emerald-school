import express, { Router, type NextFunction, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db, portalAlbumPhotos, portalAlbums, portalClasses, portalImages, portalStudents, portalTeachers, type PortalAlbumRecord } from "@workspace/db";
import { CreatePortalAlbumBody, DecidePhotoReviewBody, UpdatePortalAlbumPhotoBody } from "@workspace/api-zod";
import { check, classAllowed, portalActor, staffOnly, studentOnly, type PortalActor } from "../lib/portal-auth";
import { MAX_IMAGE_BYTES, removeImage, saveImage, serveImage, uploadsEnabled } from "../lib/images";

export const portalMediaRouter = Router();
const MAX_PHOTOS_PER_ALBUM = 300;

async function signedIn(req: Request) {
  const actor = await portalActor(req);
  check(actor.role !== "guest", "Sign in to continue.", 401);
  return actor;
}
async function adminOnly(req: Request) {
  const actor = await signedIn(req);
  check(actor.role === "admin", "Only school administrators can manage the gallery and staff photos.", 403);
  return actor;
}
const idParam = (req: Request) => {
  const id = Number(req.params.id);
  check(Number.isSafeInteger(id) && id > 0, "Not found.", 404);
  return id;
};
const uploader = (req: Request, actor: PortalActor) => req.identity?.email ?? (actor.student ? `student:${actor.student.studentId}` : null);

/** Runs the permission check before reading up to 5MB of photo into memory. */
function photoUpload(authorize: (req: Request) => Promise<unknown>) {
  return [
    async (req: Request, _res: Response, next: NextFunction) => { try { await authorize(req); next(); } catch (error) { next(error); } },
    express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
  ];
}

async function classNames() {
  return new Map((await db.select().from(portalClasses)).map((c) => [c.id, c.name]));
}
const albumVisible = (actor: PortalActor, a: PortalAlbumRecord) =>
  actor.role === "admin" || (a.published && (a.classId === null || actor.classIds.includes(a.classId)));

async function albumViews(albums: PortalAlbumRecord[]) {
  const names = await classNames();
  const photos = albums.length ? await db.select().from(portalAlbumPhotos).where(inArray(portalAlbumPhotos.albumId, albums.map((a) => a.id))).orderBy(asc(portalAlbumPhotos.id)) : [];
  return albums.map((a) => ({
    id: a.id, title: a.title, description: a.description, classId: a.classId, className: a.classId === null ? null : names.get(a.classId) ?? null,
    published: a.published, createdAt: a.createdAt.toISOString(),
    photos: photos.filter((p) => p.albumId === a.id).map((p) => ({ id: p.id, imageId: p.imageId, caption: p.caption })),
  }));
}
async function albumValues(body: unknown) {
  const data = CreatePortalAlbumBody.parse(body);
  const title = data.title.trim();
  check(title, "Give the album a title.");
  const classId = data.classId ?? null;
  if (classId !== null) {
    const [row] = await db.select({ id: portalClasses.id }).from(portalClasses).where(eq(portalClasses.id, classId));
    check(row, "Class not found.", 404);
  }
  return { title, description: (data.description ?? "").trim(), classId, published: data.published };
}

// ---- Gallery
portalMediaRouter.get("/albums", async (req, res) => {
  const actor = await signedIn(req);
  const albums = (await db.select().from(portalAlbums).orderBy(desc(portalAlbums.createdAt))).filter((a) => albumVisible(actor, a));
  res.json(await albumViews(albums));
});
portalMediaRouter.post("/albums", async (req, res) => {
  await adminOnly(req);
  const [row] = await db.insert(portalAlbums).values(await albumValues(req.body)).returning();
  res.json((await albumViews([row]))[0]);
});
portalMediaRouter.put("/albums/:id", async (req, res) => {
  await adminOnly(req);
  const [row] = await db.update(portalAlbums).set(await albumValues(req.body)).where(eq(portalAlbums.id, idParam(req))).returning();
  check(row, "Album not found.", 404);
  res.json((await albumViews([row]))[0]);
});
portalMediaRouter.delete("/albums/:id", async (req, res) => {
  await adminOnly(req);
  const id = idParam(req);
  const photos = await db.select({ imageId: portalAlbumPhotos.imageId }).from(portalAlbumPhotos).where(eq(portalAlbumPhotos.albumId, id));
  const [row] = await db.delete(portalAlbums).where(eq(portalAlbums.id, id)).returning({ id: portalAlbums.id });
  check(row, "Album not found.", 404);
  for (const p of photos) await removeImage(p.imageId);
  res.json({ message: "Album deleted." });
});
portalMediaRouter.post("/albums/:id/photos", ...photoUpload(adminOnly), async (req, res) => {
  const actor = await adminOnly(req);
  const albumId = idParam(req);
  const [album] = await db.select({ id: portalAlbums.id }).from(portalAlbums).where(eq(portalAlbums.id, albumId));
  check(album, "Album not found.", 404);
  const count = await db.$count(portalAlbumPhotos, eq(portalAlbumPhotos.albumId, albumId));
  check(count < MAX_PHOTOS_PER_ALBUM, `An album can hold up to ${MAX_PHOTOS_PER_ALBUM} photos. Start a new album.`);
  const imageId = await saveImage(req.body, "gallery", uploader(req, actor));
  const [photo] = await db.insert(portalAlbumPhotos).values({ albumId, imageId }).returning();
  res.json({ id: photo.id, imageId, caption: photo.caption });
});
portalMediaRouter.put("/album-photos/:id", async (req, res) => {
  await adminOnly(req);
  const { caption } = UpdatePortalAlbumPhotoBody.parse(req.body);
  const [photo] = await db.update(portalAlbumPhotos).set({ caption: caption.trim() }).where(eq(portalAlbumPhotos.id, idParam(req))).returning();
  check(photo, "Photo not found.", 404);
  res.json({ id: photo.id, imageId: photo.imageId, caption: photo.caption });
});
portalMediaRouter.delete("/album-photos/:id", async (req, res) => {
  await adminOnly(req);
  const [photo] = await db.delete(portalAlbumPhotos).where(eq(portalAlbumPhotos.id, idParam(req))).returning();
  check(photo, "Photo not found.", 404);
  await removeImage(photo.imageId);
  res.json({ message: "Photo removed." });
});

// ---- Serving: every photo is private and checked against who is asking.
async function mayView(actor: PortalActor, imageId: string, purpose: string) {
  if (actor.role === "admin") return true;
  if (purpose === "staff") return true; // directory portraits are for anyone signed in
  if (purpose === "gallery") {
    const rows = await db.select({ album: portalAlbums }).from(portalAlbumPhotos)
      .innerJoin(portalAlbums, eq(portalAlbums.id, portalAlbumPhotos.albumId)).where(eq(portalAlbumPhotos.imageId, imageId));
    return rows.some(({ album }) => albumVisible(actor, album));
  }
  if (purpose === "student") {
    const [owner] = await db.select().from(portalStudents)
      .where(or(eq(portalStudents.photoImageId, imageId), eq(portalStudents.pendingPhotoImageId, imageId)));
    if (!owner) return false;
    if (actor.role === "teacher") return actor.classIds.includes(owner.classId);
    return actor.student?.id === owner.id;
  }
  return false;
}
portalMediaRouter.get("/images/:id", async (req, res) => {
  const actor = await signedIn(req);
  const id = String(req.params.id);
  check(/^[0-9a-f-]{36}$/.test(id), "Photo not found.", 404);
  const [row] = await db.select().from(portalImages).where(eq(portalImages.id, id));
  check(row && await mayView(actor, row.id, row.purpose), "Photo not found.", 404);
  await serveImage(req, res, row);
});

// ---- Student profile photos: students upload, staff approve.
portalMediaRouter.get("/me/photo", async (req, res) => {
  const student = studentOnly(await portalActor(req));
  res.json({ photoId: student.photoImageId, pendingPhotoId: student.pendingPhotoImageId, uploadsEnabled: uploadsEnabled() });
});
portalMediaRouter.post("/me/photo", ...photoUpload(async (req) => studentOnly(await portalActor(req))), async (req, res) => {
  const actor = await portalActor(req);
  const student = studentOnly(actor);
  const imageId = await saveImage(req.body, "student", uploader(req, actor));
  const [before] = await db.select({ pending: portalStudents.pendingPhotoImageId }).from(portalStudents).where(eq(portalStudents.id, student.id));
  await db.update(portalStudents).set({ pendingPhotoImageId: imageId }).where(eq(portalStudents.id, student.id));
  await removeImage(before?.pending);
  res.json({ photoId: student.photoImageId, pendingPhotoId: imageId, uploadsEnabled: true });
});
portalMediaRouter.get("/photo-reviews", async (req, res) => {
  const actor = await portalActor(req);
  staffOnly(actor);
  const scope = actor.role === "admin" ? undefined : inArray(portalStudents.classId, actor.classIds.length ? actor.classIds : [-1]);
  const rows = await db.select().from(portalStudents).where(and(isNotNull(portalStudents.pendingPhotoImageId), scope)).orderBy(asc(portalStudents.name));
  const names = await classNames();
  res.json(rows.map((s) => ({ id: s.id, name: s.name, studentId: s.studentId, className: names.get(s.classId) ?? "", photoId: s.photoImageId, pendingPhotoId: s.pendingPhotoImageId! })));
});
portalMediaRouter.post("/photo-reviews/:id", async (req, res) => {
  const actor = await portalActor(req);
  staffOnly(actor);
  const { approve } = DecidePhotoReviewBody.parse(req.body);
  const [student] = await db.select().from(portalStudents).where(eq(portalStudents.id, idParam(req)));
  check(student, "Student not found.", 404);
  classAllowed(actor, student.classId);
  check(student.pendingPhotoImageId, "There is no photo waiting for this student.", 409);
  if (approve) {
    await db.update(portalStudents).set({ photoImageId: student.pendingPhotoImageId, pendingPhotoImageId: null }).where(eq(portalStudents.id, student.id));
    await removeImage(student.photoImageId);
  } else {
    await db.update(portalStudents).set({ pendingPhotoImageId: null }).where(eq(portalStudents.id, student.id));
    await removeImage(student.pendingPhotoImageId);
  }
  res.json({ message: approve ? "Photo approved." : "Photo declined." });
});
async function staffForStudent(req: Request) {
  const actor = await portalActor(req);
  staffOnly(actor);
  const [student] = await db.select().from(portalStudents).where(eq(portalStudents.id, idParam(req)));
  check(student, "Student not found.", 404);
  classAllowed(actor, student.classId);
  return { actor, student };
}
portalMediaRouter.post("/students/:id/photo", ...photoUpload(staffForStudent), async (req, res) => {
  const { actor, student } = await staffForStudent(req);
  const imageId = await saveImage(req.body, "student", uploader(req, actor));
  await db.update(portalStudents).set({ photoImageId: imageId }).where(eq(portalStudents.id, student.id));
  await removeImage(student.photoImageId);
  res.json({ message: "Photo saved." });
});
portalMediaRouter.delete("/students/:id/photo", async (req, res) => {
  const { student } = await staffForStudent(req);
  await db.update(portalStudents).set({ photoImageId: null }).where(eq(portalStudents.id, student.id));
  await removeImage(student.photoImageId);
  res.json({ message: "Photo removed." });
});

// ---- Staff portraits for the directory.
async function adminTeacher(req: Request) {
  const actor = await adminOnly(req);
  const [teacher] = await db.select().from(portalTeachers).where(eq(portalTeachers.id, idParam(req)));
  check(teacher, "Teacher not found.", 404);
  return { actor, teacher };
}
portalMediaRouter.post("/teachers/:id/photo", ...photoUpload(adminTeacher), async (req, res) => {
  const { actor, teacher } = await adminTeacher(req);
  const imageId = await saveImage(req.body, "staff", uploader(req, actor));
  await db.update(portalTeachers).set({ photoFileId: imageId }).where(eq(portalTeachers.id, teacher.id));
  await removeImage(teacher.photoFileId);
  res.json({ message: "Staff photo saved." });
});
portalMediaRouter.delete("/teachers/:id/photo", async (req, res) => {
  const { teacher } = await adminTeacher(req);
  await db.update(portalTeachers).set({ photoFileId: null }).where(eq(portalTeachers.id, teacher.id));
  await removeImage(teacher.photoFileId);
  res.json({ message: "Staff photo removed." });
});
