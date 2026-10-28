import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountRouter from "./account";
import storageRouter from "./storage";
import academicCalendarRouter from "./academic-calendar";
import admissionApplicationsRouter from "./admission-applications";
import liveUpdatesRouter from "./live-updates";
import schoolCommerceCatalogRouter from "./school-commerce-catalog";
import schoolCommerceOrdersRouter from "./school-commerce-orders";
import schoolCommerceFeesRouter from "./school-commerce-fees";
import siteContentRouter from "./site-content";
import { protectWebsiteManagement } from "../lib/website-admin";
import portalRouter from "./portal";
import emailTestRouter from "./email-test";
import schoolCommerceProofsRouter from "./school-commerce-proofs";
import directorRouter from "./director";
import { publicRateLimit } from "../lib/public-rate-limit";

const router: IRouter = Router();

// Public forms need no sign-in, so each address may only send a few an hour.
router.post("/admission-applications", publicRateLimit("admissions", 10, "Too many applications from this connection. Please wait an hour or call the school office."));
router.post("/school-commerce/orders", publicRateLimit("orders", 20, "Too many orders from this connection. Please wait an hour or contact the school office."));
router.post("/school-commerce/fee-reports", publicRateLimit("fee-reports", 20, "Too many payment reports from this connection. Please wait an hour or contact the school office."));
router.use("/portal", portalRouter);
router.use(protectWebsiteManagement);
router.use(healthRouter);
router.use(accountRouter);
router.use(storageRouter);
router.use(academicCalendarRouter);
router.use(admissionApplicationsRouter);
router.use(liveUpdatesRouter);
router.use(schoolCommerceCatalogRouter);
router.use(schoolCommerceOrdersRouter);
router.use(schoolCommerceFeesRouter);
router.use(schoolCommerceProofsRouter);
router.use(siteContentRouter);
router.use(emailTestRouter);
router.use(directorRouter);

export default router;
