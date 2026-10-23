import express, { type Express } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";
import { localUserBridge } from "./middlewares/localUserBridge";
import { startApprovedIdentityRefresh } from "./lib/approved-identities";
import { serveFrontend } from "./lib/frontend";
import { mountCspReports, securityHeaders } from "./lib/security-headers";
import { auditStaffChanges } from "./lib/audit";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(securityHeaders());
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
mountCspReports(app);
// Website files need no auth, so they are served before the Clerk middleware.
serveFrontend(app);
app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);
startApprovedIdentityRefresh();
app.use(localUserBridge);
app.use("/api", auditStaffChanges());

app.use("/api", router);

export default app;
