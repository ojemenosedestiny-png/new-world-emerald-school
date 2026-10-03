import { Router, type IRouter } from "express";
import { requireAuthentication } from "../lib/requireAuthentication";
import { isWebsiteAdmin } from "../lib/website-admin";

const router: IRouter = Router();
router.get("/account", (req, res) => {
  if (!requireAuthentication(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  res.json({ id: req.dbUser.id, isAdmin: isWebsiteAdmin(req) });
});
export default router;