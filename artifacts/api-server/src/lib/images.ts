import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, portalImages } from "@workspace/db";
import { ObjectStorageService, objectStorageClient } from "./objectStorage";
import { serveObject } from "./serve-object";
import { check, PortalError } from "./portal-auth";
import { cloudinaryReady, deleteFromCloudinary, downloadUrl, pipeFromCloudinary, uploadToCloudinary } from "./cloudinary";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const UPLOADS_OFF = "Photo uploads are not set up yet. The school office needs to connect Cloudinary or file storage (see DEPLOY-RENDER.md, section 6).";
export type ImagePurpose = "gallery" | "student" | "staff";

/** Real type from the file's first bytes; the browser's Content-Type header is never trusted. */
export function detectImage(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

type ImageStore = {
  ready(): boolean;
  save(name: string, body: Buffer, contentType: string): Promise<void>;
  remove(name: string): Promise<void>;
  serve(req: Request, res: Response, name: string, contentType: string): Promise<void>;
};

const storage = new ObjectStorageService();
function bucketFile(name: string) {
  const dir = storage.getPrivateObjectDir().replace(/^\/+|\/+$/g, "");
  const [bucket, ...prefix] = dir.split("/");
  return objectStorageClient.bucket(bucket).file([...prefix, "portal-images", name].join("/"));
}
const cloudStore: ImageStore = {
  ready: () => Boolean(process.env.PRIVATE_OBJECT_DIR?.trim()),
  save: async (name, body, contentType) => { await bucketFile(name).save(body, { contentType, resumable: false, metadata: { cacheControl: "private, max-age=86400" } }); },
  remove: async (name) => { await bucketFile(name).delete({ ignoreNotFound: true }); },
  serve: (req, res, name) => serveObject(req, res, storage, async () => bucketFile(name)),
};
// Cloudinary keeps portal photos private ("authenticated"); they are only served through mayView checks.
// Their stored object names start with "cloudinary:" so older bucket photos keep working after the switch.
const CLOUDINARY_PREFIX = "cloudinary:";
const cloudinaryPublicId = (name: string) => `nwe/portal/images/${name.slice(CLOUDINARY_PREFIX.length)}`;
const cloudinaryStore: ImageStore = {
  ready: cloudinaryReady,
  save: async (name, body) => {
    // Turn Cloudinary's reason into a message the portal shows instead of a generic error.
    try { await uploadToCloudinary(body, { publicId: cloudinaryPublicId(name), resourceType: "image", visibility: "private", maxBytes: MAX_IMAGE_BYTES }); }
    catch (error) { throw new PortalError((error as { status?: number }).status ?? 502, (error as Error).message); }
  },
  remove: async (name) => { await deleteFromCloudinary(cloudinaryPublicId(name), "image", "private"); },
  serve: (_req, res, name, contentType) => pipeFromCloudinary(res, downloadUrl(cloudinaryPublicId(name), "image", "private", contentType), { "Content-Type": contentType }),
};
let testStore: ImageStore | null = null;
/** New photos go to Cloudinary when CLOUDINARY_URL is set, otherwise the bucket; tests use memory. */
const activeStore = () => testStore ?? (cloudinaryReady() ? cloudinaryStore : cloudStore);
/** The store that holds an existing photo. */
const storeFor = (objectName: string) => testStore ?? (objectName.startsWith(CLOUDINARY_PREFIX) ? cloudinaryStore : cloudStore);

/** Tests keep photos in memory instead of a real bucket. */
export function useMemoryImageStore() {
  const files = new Map<string, Buffer>();
  testStore = {
    ready: () => true,
    save: async (name, body) => { files.set(name, body); },
    remove: async (name) => { files.delete(name); },
    serve: async (_req, res, name, contentType) => {
      const body = files.get(name);
      if (!body) { res.status(404).json({ error: "Photo not found." }); return; }
      res.setHeader("Content-Type", contentType);
      res.end(body);
    },
  };
  return files;
}

export const uploadsEnabled = () => activeStore().ready();

/** Checks and stores an uploaded photo; returns its id. */
export async function saveImage(body: unknown, purpose: ImagePurpose, uploadedBy: string | null) {
  check(activeStore().ready(), UPLOADS_OFF, 503);
  check(Buffer.isBuffer(body) && body.length > 0, "Choose a photo to upload.");
  check(body.length <= MAX_IMAGE_BYTES, "Photos can be up to 5MB.", 413);
  const contentType = detectImage(body);
  check(contentType, "Upload a JPEG, PNG or WebP photo.");
  const id = randomUUID();
  const store = activeStore();
  const objectName = store === cloudinaryStore ? CLOUDINARY_PREFIX + id : id;
  await store.save(objectName, body, contentType);
  try { await db.insert(portalImages).values({ id, objectName, contentType, size: body.length, purpose, uploadedBy }); }
  catch (error) { await store.remove(objectName).catch(() => {}); throw error; }
  return id;
}

/** Deletes a photo record and its stored file. Missing ids are ignored. */
export async function removeImage(id: string | null | undefined) {
  if (!id) return;
  const [row] = await db.delete(portalImages).where(eq(portalImages.id, id)).returning();
  if (row) await storeFor(row.objectName).remove(row.objectName).catch(() => {});
}

export async function serveImage(req: Request, res: Response, row: { objectName: string; contentType: string }) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("Content-Disposition", "inline");
  res.type(row.contentType);
  await storeFor(row.objectName).serve(req, res, row.objectName, row.contentType);
}
