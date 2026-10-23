# Deploying to Render

The website and API run as **one Render web service** (the API serves the built site), with a **Render Postgres** database. Uploaded photos and PDFs go to a **Google Cloud Storage** bucket, and sign-in uses **your own Clerk app**.

Replit keeps working unchanged: every Render-only behaviour is switched on by an environment variable Replit does not set.

## 1. Google Cloud Storage (photos and PDFs)

1. In Google Cloud Console, create a bucket (e.g. `nwe-school-files`). Keep **public access prevention** on; the API serves files itself.
2. Create a service account, then grant it **Storage Object Admin** on that bucket only.
3. Create a JSON key for the service account and keep the file private.
4. Allow browser uploads from your site (the admin uploads straight to the bucket with a signed URL). Save this as `cors.json`, with your real site address:
   ```json
   [{ "origin": ["https://YOUR-SITE.onrender.com"], "method": ["PUT", "GET", "HEAD"], "responseHeader": ["Content-Type"], "maxAgeSeconds": 3600 }]
   ```
   Then run `gcloud storage buckets update gs://nwe-school-files --cors-file=cors.json`. Add your custom domain to `origin` when you have one.

## 2. Clerk (sign-in)

1. Create an application at clerk.com with **Email** sign-in and **email verification required**.
2. **Required:** Configure → Sessions → *Customize session token*, and set:
   ```json
   { "userId": "{{user.id}}", "email": "{{user.primary_email_address}}" }
   ```
   Without this every sign-in fails with "Account identity could not be resolved."
3. Copy the publishable key (`pk_...`) and secret key (`sk_...`).
   - A **development** key (`pk_test_...`) works on `*.onrender.com`.
   - A **production** key (`pk_live_...`) needs your own domain with Clerk's DNS records (`clerk.yourdomain`), as Clerk's dashboard explains.

## 3. Render

1. Push this repository to GitHub.
2. In Render: **New → Blueprint**, pick the repository. Render reads `render.yaml` and creates the web service and the database.
3. Fill in the values Render asks for:

| Variable | Value |
|---|---|
| `SCHOOL_ADMIN_EMAILS` | Website administrator emails, comma-separated |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `VITE_CLERK_PUBLISHABLE_KEY` | The same publishable key (built into the website) |
| `GCS_SERVICE_ACCOUNT_JSON` | The whole service account JSON key (or the same, base64-encoded) |
| `PRIVATE_OBJECT_DIR` | `/nwe-school-files/private` |
| `PUBLIC_OBJECT_SEARCH_PATHS` | `/nwe-school-files/public` |

`DATABASE_URL`, `NODE_ENV`, `NODE_VERSION` and `FRONTEND_DIST_DIR` are set by the Blueprint.

Each deploy runs `scripts/render-build.sh`: install, apply the database schema, build the API and the website. Render checks `/api/healthz` before switching traffic. If a schema change would drop or rename data, the build stops and the live site keeps running. Plan that change by hand with a backup. To skip the automatic schema step, set `SKIP_DB_PUSH=true`.

The free Render plan sleeps when idle, so the first visit after a quiet period is slow. Use a paid plan for live exams.

## 4. Moving existing data from Replit (optional)

- **Database:** `pg_dump --no-owner --no-acl "$REPLIT_DATABASE_URL" | psql "$RENDER_EXTERNAL_DATABASE_URL"`. Use Render's *External Database URL* and deploy once first so the tables exist, or dump with `--clean`.
- **Files:** download them from Replit's Object Storage tool and upload them to the bucket under the same paths (`private/...`, `public/...`).
- **Accounts:** administrators and teachers sign up again in the new Clerk app with the same email. Access is granted by email, so their rights carry over.

## Check it worked

- `https://YOUR-SITE.onrender.com/api/healthz` returns `{"status":"ok"}`.
- Sign in at `/sign-in` with an email in `SCHOOL_ADMIN_EMAILS` and confirm `/admin` opens.
- Upload a store photo in the admin panel and confirm it shows on the homepage (this tests the bucket and CORS).
- Create a class and student at `/portal/manage`, then log in at `/portal`.

## 5. Security settings

| Variable | What it does |
|---|---|
| `SCHOOL_SUPER_ADMIN_EMAILS` | Who can read the audit log. Leave empty to use the first email in `SCHOOL_ADMIN_EMAILS`. |
| `REQUIRE_ADMIN_MFA` | `true` makes every administrator turn on two-factor authentication before they can manage anything. |
| `CSP_ENFORCE` | `false` (default) sends the Content-Security-Policy in report-only mode; `true` enforces it. |

**Turning on required two-factor (in this order, so nobody is locked out):**
1. In the Clerk dashboard: *Configure → Multi-factor*, enable **Authenticator application** and **Backup codes**. (Clerk may need a paid plan for MFA on a production instance; development instances include it.)
2. Sign in to the site, open your account (top right) → *Security*, add an authenticator app and save your backup codes.
3. In Render set `REQUIRE_ADMIN_MFA=true`. Other administrators are guided through setup the next time they sign in.

**Enforcing the Content-Security-Policy:** watch the Render logs for `CSP violation report` lines for a few days of normal use (sign-in, uploads, printing, exams). If none point at something the site needs, set `CSP_ENFORCE=true`.

**Idle sign-out:** staff and students are signed out after 30 minutes without activity (a one-minute warning first). Students in the middle of an exam are not signed out; the exam timer decides.

**Audit log:** every staff change (who, what, when, IP address, device, before and after) and security events such as failed student sign-ins are recorded. The log is append-only and visible only to the super administrator in *Portal management → Audit log*.

## 6. Backups and restore

- **Automatic:** Render Postgres paid plans take daily backups with point-in-time recovery (*Database → Recovery*). The free plan has no backups.
- **Manual copy before risky changes:** `pg_dump --no-owner --format=custom "$RENDER_EXTERNAL_DATABASE_URL" > nwe-$(date +%F).dump`
- **Restore a manual copy into an empty database:** `pg_restore --no-owner --clean --if-exists -d "$TARGET_DATABASE_URL" nwe-YYYY-MM-DD.dump`, then point `DATABASE_URL` at it and redeploy.
