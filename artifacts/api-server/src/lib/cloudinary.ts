import { createHmac, timingSafeEqual } from "node:crypto";
import { Readable, Transform } from "node:stream";
import type { Response } from "express";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

/**
 * Cloudinary media storage. Turned on by CLOUDINARY_URL
 * (cloudinary://API_KEY:API_SECRET@CLOUD_NAME, from the Cloudinary dashboard).
 * Website media is public and served from Cloudinary's CDN; portal files are
 * "authenticated" (private) and only reach people through our permission checks.
 */
export type ResourceType = "image" | "video" | "raw";
export type Visibility = "public" | "private";

export function cloudinaryCredentials(url = process.env.CLOUDINARY_URL) {
  const match = /^cloudinary:\/\/([^:@\s]+):([^@\s]+)@([a-z0-9_-]+)\/?$/i.exec(url?.trim() ?? "");
  return match ? { apiKey: match[1], apiSecret: decodeURIComponent(match[2]), cloudName: match[3] } : null;
}
export const cloudinaryReady = () => cloudinaryCredentials() !== null;

let configured = "";
function client() {
  const creds = cloudinaryCredentials();
  if (!creds) throw new Error("CLOUDINARY_URL is not set");
  const key = `${creds.cloudName}:${creds.apiKey}`;
  if (configured !== key) {
    cloudinary.config({ cloud_name: creds.cloudName, api_key: creds.apiKey, api_secret: creds.apiSecret, secure: true, analytics: false });
    configured = key;
  }
  return cloudinary;
}

/** Images and videos get Cloudinary's media handling; everything else (PDFs) is stored as-is. */
export function resourceTypeFor(contentType: string): ResourceType {
  if (/^image\/(jpeg|png|webp|gif|avif)$/i.test(contentType)) return "image";
  if (/^(video|audio)\//i.test(contentType)) return "video";
  return "raw";
}
const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif",
  "image/svg+xml": "svg", "text/plain": "txt", "text/csv": "csv",
};
export const extensionFor = (contentType: string) => EXTENSIONS[contentType.toLowerCase()] ?? "bin";

/** Public id for a stored file; raw files keep their extension so downloads open correctly. */
export function publicIdFor(folder: string, id: string, contentType: string) {
  return resourceTypeFor(contentType) === "raw" ? `${folder}/${id}.${extensionFor(contentType)}` : `${folder}/${id}`;
}

/** Streams a file to Cloudinary; refuses to read more than maxBytes. */
export async function uploadToCloudinary(body: Buffer | Readable, opts: { publicId: string; resourceType: ResourceType; visibility: Visibility; maxBytes: number }) {
  const sdk = client();
  let seen = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      seen += chunk.length;
      done(seen > opts.maxBytes ? Object.assign(new Error("File too large"), { status: 413 }) : null, chunk);
    },
  });
  return new Promise<UploadApiResponse>((resolve, reject) => {
    const sink = sdk.uploader.upload_stream({
      public_id: opts.publicId, resource_type: opts.resourceType, type: opts.visibility === "private" ? "authenticated" : "upload",
      overwrite: false, unique_filename: false, use_filename: false,
    }, (error, result) => (error || !result ? reject(friendlyError(error)) : resolve(result)));
    const source = Buffer.isBuffer(body) ? Readable.from([body]) : body;
    source.on("error", reject);
    limiter.on("error", (e) => { sink.destroy(); reject(e); });
    source.pipe(limiter).pipe(sink);
  });
}

function friendlyError(error: unknown) {
  const message = (error as { message?: string } | undefined)?.message ?? "";
  if (/file size too large|too large/i.test(message)) return Object.assign(new Error("This file is larger than your Cloudinary plan allows."), { status: 413 });
  return Object.assign(new Error("The file could not be saved to Cloudinary. Please try again."), { status: 502, cause: error });
}

export async function deleteFromCloudinary(publicId: string, resourceType: ResourceType, visibility: Visibility) {
  await client().uploader.destroy(publicId, { resource_type: resourceType, type: visibility === "private" ? "authenticated" : "upload", invalidate: true });
}

/** CDN address of a public image or video. */
export function publicUrl(publicId: string, resourceType: ResourceType) {
  return client().url(publicId, { resource_type: resourceType, type: "upload", secure: true });
}

/** Short-lived signed download address for the original file (private files and PDFs). */
export function downloadUrl(publicId: string, resourceType: ResourceType, visibility: Visibility, contentType: string) {
  const format = resourceType === "raw" ? "" : extensionFor(contentType);
  return client().utils.private_download_url(publicId, format, {
    resource_type: resourceType, type: visibility === "private" ? "authenticated" : "upload", expires_at: Math.floor(Date.now() / 1000) + 300,
  });
}

/** Fetches a file from Cloudinary and streams it to the visitor, so our own permission checks stay in front. */
export async function pipeFromCloudinary(res: Response, url: string, headers: Record<string, string>) {
  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    res.status(upstream.status === 404 ? 404 : 502).json({ error: upstream.status === 404 ? "File not found." : "The file could not be loaded. Please try again." });
    return;
  }
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  const length = upstream.headers.get("content-length");
  if (length) res.setHeader("Content-Length", length);
  await new Promise<void>((resolve, reject) => {
    const body = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream);
    body.on("error", reject);
    res.on("close", () => { body.destroy(); resolve(); });
    body.pipe(res).on("finish", resolve);
  });
}

// ---- Upload permissions: the browser sends files without cookies, so the address itself carries a signed grant.
export type UploadGrant = { id: string; contentType: string; size: number; expires: number };
const b64 = (s: Buffer | string) => Buffer.from(s).toString("base64url");
function signingKey() {
  const creds = cloudinaryCredentials();
  if (!creds) throw new Error("CLOUDINARY_URL is not set");
  return createHmac("sha256", creds.apiSecret).update("nwe-upload-grant-v1").digest();
}
export function signUploadGrant(grant: UploadGrant) {
  const payload = b64(JSON.stringify(grant));
  return `${payload}.${b64(createHmac("sha256", signingKey()).update(payload).digest())}`;
}
export function verifyUploadGrant(token: string, now = Date.now()): UploadGrant | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature || token.length > 2000) return null;
  const expected = createHmac("sha256", signingKey()).update(payload).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const grant = JSON.parse(Buffer.from(payload, "base64url").toString()) as UploadGrant;
    return typeof grant.id === "string" && grant.expires > now ? grant : null;
  } catch { return null; }
}
