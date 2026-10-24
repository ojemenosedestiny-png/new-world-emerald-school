import { Router, type ErrorRequestHandler } from "express";
import { portalOriginGuard, PortalError } from "../lib/portal-auth";
import { portalSessionRouter } from "./portal-session";
import { portalStudentRouter } from "./portal-student";
import { portalManagementRouter } from "./portal-management";
import { portalFilesRouter } from "./portal-files";
import { portalReportsRouter } from "./portal-reports";
import { portalSecurityRouter } from "./portal-security";
import { portalAccountsRouter } from "./portal-accounts";
import { portalCommunityRouter } from "./portal-community";
import { portalMediaRouter } from "./portal-media";
import { portalLearningRouter } from "./portal-learning";
import { portalMessagesRouter } from "./portal-messages";

const portalRouter = Router();
portalRouter.use(portalOriginGuard);
portalRouter.use(portalSessionRouter);
portalRouter.use(portalStudentRouter);
portalRouter.use(portalManagementRouter);
portalRouter.use(portalFilesRouter);
portalRouter.use(portalReportsRouter);
portalRouter.use(portalSecurityRouter);
portalRouter.use(portalAccountsRouter);
portalRouter.use(portalCommunityRouter);
portalRouter.use(portalMediaRouter);
portalRouter.use(portalLearningRouter);
portalRouter.use(portalMessagesRouter);
const errors: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent) { if (!res.destroyed) res.destroy(); return; }
  if (error instanceof PortalError) { res.status(error.status).json({ error: error.message }); return; }
  if (error?.name === "ZodError") { res.status(400).json({ error: "Some fields are missing or invalid. Check the form and try again." }); return; }
  if (error?.type === "entity.too.large") { res.status(413).json({ error: req.path.endsWith("/photo") || req.path.includes("/albums/") ? "This photo is too large. Photos can be up to 5MB." : "This upload is too large. The PDF limit is 15MB." }); return; }
  if (error?.code === "23505") { res.status(409).json({ error: "That student ID, email address or class name already exists." }); return; }
  req.log.error({ err: error }, "Portal request failed");
  res.status(500).json({ error: "The portal could not complete this request. Please try again." });
};
portalRouter.use(errors);
export default portalRouter;
