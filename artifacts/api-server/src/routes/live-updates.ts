import {
  CreateLiveUpdateBody,
  CreateLiveUpdateResponse,
  DeleteLiveUpdateParams,
  ListLiveUpdatesResponse,
  UpdateLiveUpdateBody,
  UpdateLiveUpdateParams,
  UpdateLiveUpdateResponse,
} from "@workspace/api-zod";
import { db, liveUpdatesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuthentication } from "../lib/requireAuthentication";

const router: IRouter = Router();
const maxVideoSize = 100 * 1024 * 1024;

function isVideoPayload(payload: {
  contentType?: string;
  fileSize?: number;
}) {
  return Boolean(
    payload.contentType?.startsWith("video/") &&
      payload.fileSize &&
      payload.fileSize <= maxVideoSize,
  );
}

router.get(
  "/live-updates",
  async (_req: Request, res: Response): Promise<void> => {
    const updates = await db
      .select()
      .from(liveUpdatesTable)
      .orderBy(desc(liveUpdatesTable.publishedAt));

    res.json(ListLiveUpdatesResponse.parse(updates));
  },
);

router.post(
  "/live-updates",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;

    const parsed = CreateLiveUpdateBody.safeParse(req.body);
    if (!parsed.success || !isVideoPayload(parsed.data)) {
      res.status(400).json({
        error: "Add a video file up to 100 MB with a title before publishing.",
      });
      return;
    }

    const [created] = await db
      .insert(liveUpdatesTable)
      .values({
        ...parsed.data,
        uploadedBy: req.dbUser.id,
      })
      .returning();

    res.status(201).json(CreateLiveUpdateResponse.parse(created));
  },
);

router.patch(
  "/live-updates/:id",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;

    const params = UpdateLiveUpdateParams.safeParse(req.params);
    const body = UpdateLiveUpdateBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid live update details." });
      return;
    }

    const [existing] = await db
      .select()
      .from(liveUpdatesTable)
      .where(eq(liveUpdatesTable.id, params.data.id));

    if (!existing) {
      res.status(404).json({ error: "Live update not found." });
      return;
    }

    if (!isVideoPayload({ ...existing, ...body.data })) {
      res.status(400).json({ error: "Invalid live update details." });
      return;
    }

    const [updated] = await db
      .update(liveUpdatesTable)
      .set(body.data)
      .where(eq(liveUpdatesTable.id, params.data.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Live update not found." });
      return;
    }

    res.json(UpdateLiveUpdateResponse.parse(updated));
  },
);

router.delete(
  "/live-updates/:id",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;

    const params = DeleteLiveUpdateParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid live update id." });
      return;
    }

    const [deleted] = await db
      .delete(liveUpdatesTable)
      .where(eq(liveUpdatesTable.id, params.data.id))
      .returning({ id: liveUpdatesTable.id });

    if (!deleted) {
      res.status(404).json({ error: "Live update not found." });
      return;
    }

    res.sendStatus(204);
  },
);

export default router;