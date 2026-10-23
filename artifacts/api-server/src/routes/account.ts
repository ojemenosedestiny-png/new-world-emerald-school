import { Router, type IRouter } from "express";
import { requireAuthentication } from "../lib/requireAuthentication";
import { adminNeedsMfa, isSuperAdmin, isWebsiteAdmin } from "../lib/website-admin";
import { refreshApprovedIdentitiesSoon } from "../lib/approved-identities";

const router: IRouter = Router();
router.get("/account", (req, res) => {
  if (!requireAuthentication(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  const mfaRequired = adminNeedsMfa(req);
  if (mfaRequired) refreshApprovedIdentitiesSoon();
  res.json({ id: req.dbUser.id, isAdmin: isWebsiteAdmin(req), isSuperAdmin: isSuperAdmin(req), mfaRequired });
});
export default router;