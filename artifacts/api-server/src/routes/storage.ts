import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response } from 'express';

import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage';
import { serveObject } from '../lib/serve-object';
import { requireAuthentication } from '../lib/requireAuthentication';

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