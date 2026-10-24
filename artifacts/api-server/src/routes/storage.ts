import {
  GetMediaStorageStatusResponse,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';

import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage';
import { serveObject } from '../lib/serve-object';
import { requireAuthentication } from '../lib/requireAuthentication';
import { isWebsiteAdmin } from '../lib/website-admin';
import {
  cloudinaryCredentials, cloudinaryUrlProblem, deleteFromCloudinary,
  cloudinaryReady, downloadUrl, pipeFromCloudinary, publicIdFor, publicUrl, resourceTypeFor,
  signUploadGrant, uploadToCloudinary, verifyUploadGrant, type ResourceType,
} from '../lib/cloudinary';

/** Largest website upload accepted (live update videos are the biggest). */
export const MAX_SITE_UPLOAD_BYTES = 100 * 1024 * 1024;
const UPLOAD_GRANT_MINUTES = 30;

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * Request a presigned URL for file upload. The client sends JSON metadata,
 * then uploads directly to storage. Public callers cannot mint upload URLs.
 */
router.post(
  '/storage/uploads/request-url',
  async (req: Request, res: Response) => {
    if (!requireAuthentication(req, res)) return;
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }
    try {
      const { name, size, contentType } = parsed.data;
      if (cloudinaryReady()) {
        if (size > MAX_SITE_UPLOAD_BYTES) {
          res.status(413).json({ error: 'Files can be up to 100 MB.' });
          return;
        }
        // The browser then sends the file to our own address below, which passes it to Cloudinary.
        const id = randomUUID();
        const token = signUploadGrant({ id, contentType, size, expires: Date.now() + UPLOAD_GRANT_MINUTES * 60_000 });
        res.json(RequestUploadUrlResponse.parse({
          uploadURL: `/api/storage/uploads/${token}`,
          objectPath: `/objects/uploads/${id}`,
          metadata: { name, size, contentType },
        }));
        return;
      }
      if (!process.env.PRIVATE_OBJECT_DIR?.trim()) {
        // Neither Cloudinary nor a bucket is usable: say what to fix instead of a server error.
        res.status(503).json({ error: cloudinaryUrlProblem() ?? 'Uploads are not set up yet. Add CLOUDINARY_URL in Render (see the Media storage card in /admin).' });
        return;
      }
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath =
        objectStorageService.normalizeObjectEntityPath(uploadURL);
      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, 'Error generating upload URL');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

// A 1x1 transparent PNG for the connection test.
const TEST_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function adminOnly(req: Request, res: Response) {
  if (!requireAuthentication(req, res)) return false;
  if (!isWebsiteAdmin(req)) { res.status(403).json({ error: 'Website administrators only.' }); return false; }
  return true;
}

/** Which media storage is in use, for the admin dashboard. */
router.get('/storage/status', (req: Request, res: Response) => {
  if (!adminOnly(req, res)) return;
  const creds = cloudinaryCredentials();
  const bucket = Boolean(process.env.PRIVATE_OBJECT_DIR?.trim());
  res.json(GetMediaStorageStatusResponse.parse({
    provider: creds ? 'cloudinary' : bucket ? 'bucket' : 'none',
    ready: Boolean(creds) || bucket,
    cloudName: creds?.cloudName ?? null,
  }));
});

/** Proves the storage works end to end: public and private upload, load back, delete. */
router.post('/storage/status', async (req: Request, res: Response) => {
  if (!adminOnly(req, res)) return;
  if (!cloudinaryReady()) {
    const problem = cloudinaryUrlProblem();
    if (problem) { res.json({ ok: false, detail: problem }); return; }
    res.json({ ok: false, detail: process.env.PRIVATE_OBJECT_DIR ? 'Bucket storage is configured. Upload a photo to try it.' : 'No media storage is configured yet. Add CLOUDINARY_URL in Render.' });
    return;
  }
  const id = `nwe/healthcheck/${randomUUID()}`;
  const cleanup: Array<() => Promise<unknown>> = [];
  try {
    await uploadToCloudinary(TEST_PNG, { publicId: id, resourceType: 'image', visibility: 'public', maxBytes: 1024 });
    cleanup.push(() => deleteFromCloudinary(id, 'image', 'public'));
    const pub = await fetch(publicUrl(id, 'image'));
    if (!pub.ok) throw new Error(`Uploaded, but the public copy could not be loaded (HTTP ${pub.status}).`);
    const privateId = `${id}-private`;
    await uploadToCloudinary(TEST_PNG, { publicId: privateId, resourceType: 'image', visibility: 'private', maxBytes: 1024 });
    cleanup.push(() => deleteFromCloudinary(privateId, 'image', 'private'));
    const priv = await fetch(downloadUrl(privateId, 'image', 'private', 'image/png'));
    if (!priv.ok) throw new Error(`Uploaded, but the private copy could not be loaded (HTTP ${priv.status}).`);
    res.json({ ok: true, detail: `Connected to Cloudinary (${cloudinaryCredentials()?.cloudName}). Upload, delivery and private files all work.` });
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause?.message;
    req.log.warn({ err: error }, 'Cloudinary connection test failed');
    res.json({ ok: false, detail: cause ? `Cloudinary said: ${cause}` : (error as Error).message });
  } finally {
    for (const undo of cleanup) await undo().catch(() => {});
  }
});

/**
 * Receive a file for a signed upload address and store it on Cloudinary.
 * No cookies arrive here; the signed grant in the address is the permission.
 */
router.put('/storage/uploads/:token', async (req: Request, res: Response) => {
  if (!cloudinaryReady()) { res.status(404).json({ error: 'Not found' }); return; }
  const grant = verifyUploadGrant(String(req.params.token));
  if (!grant) { res.status(403).json({ error: 'This upload link has expired. Please try again.' }); return; }
  const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== grant.contentType.toLowerCase()) { res.status(400).json({ error: 'The file type does not match the upload request.' }); return; }
  const records = await import('../lib/media-objects');
  if (await records.findMediaObject(grant.id)) { res.status(409).json({ error: 'This upload link was already used.' }); return; }
  const resourceType = resourceTypeFor(contentType);
  const publicId = publicIdFor('nwe/site', grant.id, contentType);
  try {
    const result = await uploadToCloudinary(req, { publicId, resourceType, visibility: 'public', maxBytes: Math.min(grant.size, MAX_SITE_UPLOAD_BYTES) });
    await records.recordMediaObject({ id: grant.id, publicId, resourceType, contentType, size: result.bytes ?? grant.size });
    res.status(200).type('text/plain').send('OK');
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    req.log.error({ err: error }, 'Cloudinary upload failed');
    if (!res.headersSent) res.status(status).json({ error: (error as Error).message || 'Upload failed' });
  }
});

/**
 * Serve assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 */
router.get(
  '/storage/public-objects/*filePath',
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join('/') : raw;
      await serveObject(req, res, objectStorageService, async () => {
        const file = await objectStorageService.searchPublicObject(filePath);
        if (!file) throw new ObjectNotFoundError();
        return file;
      });
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) {
        req.log.error({ err: error }, 'Error streaming public object');
        res.destroy();
        return;
      }
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      req.log.error({ err: error }, 'Error serving public object');
      res.removeHeader('Content-Length');
      res.removeHeader('Content-Range');
      res.status(500).json({ error: 'Failed to serve public object' });
    }
  },
);

/**
 * Serve object entities from PRIVATE_OBJECT_DIR. Preserve the existing
 * public-read behavior of this route; upload URL creation still requires auth.
 */
router.get('/storage/objects/*path', async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const cloudId = /^uploads\/([0-9a-f-]{36})$/.exec(wildcardPath)?.[1];
    const media = cloudId && cloudinaryReady() ? await (await import('../lib/media-objects')).findMediaObject(cloudId) : undefined;
    if (media) {
      const type = media.resourceType as ResourceType;
      if (type === 'raw') {
        // PDFs and other documents stream through us with their original type.
        await pipeFromCloudinary(res, downloadUrl(media.publicId, type, 'public', media.contentType), {
          'Content-Type': media.contentType, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline',
        });
      } else {
        // Photos and videos come straight from Cloudinary's CDN.
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.redirect(302, publicUrl(media.publicId, type));
      }
      return;
    }
    await serveObject(req, res, objectStorageService, () =>
      objectStorageService.getObjectEntityFile(objectPath));
  } catch (error) {
    if (res.destroyed) return;
    if (res.headersSent) {
      req.log.error({ err: error }, 'Error streaming object');
      res.destroy();
      return;
    }
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, 'Object not found');
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    req.log.error({ err: error }, 'Error serving object');
    res.removeHeader('Content-Length');
    res.removeHeader('Content-Range');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

export default router;