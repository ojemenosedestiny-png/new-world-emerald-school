import {
  CreateAcademicCalendarBody,
  CreateAcademicCalendarResponse,
  DeleteAcademicCalendarParams,
  ListAcademicCalendarResponse,
} from "@workspace/api-zod";
import { academicCalendarTable, db } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

function requireAuthentication(
  req: Request,
  res: Response,
): req is Request & { user: Express.User } {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  return true;
}

router.get(
  "/academic-calendar",
  async (_req: Request, res: Response): Promise<void> => {
    const calendars = await db
      .select()
      .from(academicCalendarTable)
      .orderBy(desc(academicCalendarTable.weekStart), desc(academicCalendarTable.uploadedAt));

    res.json(ListAcademicCalendarResponse.parse(calendars));
  },
);

router.post(
  "/academic-calendar",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;

    const parsed = CreateAcademicCalendarBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid calendar details" });
      return;
    }

    const calendar = parsed.data;
    const [created] = await db
      .insert(academicCalendarTable)
      .values({
        title: calendar.title,
        weekStart: calendar.weekStart.toISOString().slice(0, 10),
        weekEnd: calendar.weekEnd.toISOString().slice(0, 10),
        term: calendar.term,
        fileName: calendar.fileName,
        objectPath: calendar.objectPath,
        contentType: calendar.contentType,
        fileSize: calendar.fileSize,
        uploadedBy: req.user.id,
      })
      .returning();

    res.status(201).json(CreateAcademicCalendarResponse.parse(created));
  },
);

router.delete(
  "/academic-calendar/:id",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;

    const parsed = DeleteAcademicCalendarParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid calendar id" });
      return;
    }

    const [deleted] = await db
      .delete(academicCalendarTable)
      .where(eq(academicCalendarTable.id, parsed.data.id))
      .returning({ id: academicCalendarTable.id });

    if (!deleted) {
      res.status(404).json({ error: "Calendar not found" });
      return;
    }

    res.sendStatus(204);
  },
);

export default router;