import {
  CreateAdmissionApplicationBody,
  CreateAdmissionApplicationResponse,
  ListAdmissionApplicationsResponse,
  UpdateAdmissionApplicationBody,
  UpdateAdmissionApplicationParams,
  UpdateAdmissionApplicationResponse,
} from "@workspace/api-zod";
import { admissionApplicationsTable, db } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();
const allowedStatuses = new Set([
  "new",
  "contacted",
  "invited",
  "accepted",
  "declined",
]);

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

router.post(
  "/admission-applications",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateAdmissionApplicationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please complete all application fields." });
      return;
    }

    const [created] = await db
      .insert(admissionApplicationsTable)
      .values({
        ...parsed.data,
        status: "new",
      })
      .returning();

    res.status(201).json(CreateAdmissionApplicationResponse.parse(created));
  },
);

router.get(
  "/admission-applications",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;

    const applications = await db
      .select()
      .from(admissionApplicationsTable)
      .orderBy(desc(admissionApplicationsTable.submittedAt));

    res.json(ListAdmissionApplicationsResponse.parse(applications));
  },
);

router.patch(
  "/admission-applications/:id",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;

    const params = UpdateAdmissionApplicationParams.safeParse(req.params);
    const body = UpdateAdmissionApplicationBody.safeParse(req.body);
    if (!params.success || !body.success || !allowedStatuses.has(body.data.status)) {
      res.status(400).json({ error: "Invalid application status." });
      return;
    }

    const [updated] = await db
      .update(admissionApplicationsTable)
      .set({ status: body.data.status })
      .where(eq(admissionApplicationsTable.id, params.data.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Application not found." });
      return;
    }

    res.json(UpdateAdmissionApplicationResponse.parse(updated));
  },
);

export default router;