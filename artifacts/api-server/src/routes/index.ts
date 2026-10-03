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

const router: IRouter = Router();

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
router.use(siteContentRouter);

export default router;
