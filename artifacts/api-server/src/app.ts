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
import { startDirectorWeeklyReport } from "./routes/director";
import { serveFrontend } from "./lib/frontend";
import { loadSiteContentSnapshot } from "./routes/site-content";
import { mountCspReports, securityHeaders } from "./lib/security-headers";
import { auditStaffChanges } from "./lib/audit";
import { siteRedirects } from "./lib/site-redirects";
import { clerkEmailWebhook } from "./routes/clerk-email-webhook";
import { paystackWebhook } from "./routes/paystack-webhook";
import { bodyShapeGuard, corsOptions } from "./lib/request-guards";

const app: Express = express();
// Do not advertise the framework in every response.
app.disable("x-powered-by");

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
// Old WordPress addresses and the Render address forward to the right place first.
app.use(siteRedirects());
// Website files need no auth, so they are served before the Clerk middleware.
serveFrontend(app, undefined, loadSiteContentSnapshot);
// Only this site's own pages may call the API with a visitor's cookies (no other website).
app.use(cors(corsOptions));
// Clerk's signed email webhook needs the raw body, so it is mounted before the JSON parser.
app.post("/api/webhooks/clerk-email", express.raw({ type: "application/json", limit: "1mb" }), clerkEmailWebhook);
// Paystack signs its payment notices over the raw body too.
app.post("/api/webhooks/paystack", express.raw({ type: "application/json", limit: "256kb" }), paystackWebhook);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb", parameterLimit: 1000 }));
// Oversized bodies are refused before validation (see request-guards).
app.use(bodyShapeGuard);
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);
startApprovedIdentityRefresh();
startDirectorWeeklyReport();
app.use(localUserBridge);
app.use("/api", auditStaffChanges());

app.use("/api", router);

export default app;
