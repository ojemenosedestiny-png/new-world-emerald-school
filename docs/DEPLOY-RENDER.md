# Deploying to Render

The website and API run as **one Render web service** (the API serves the built site), with a **Render Postgres** database. Uploaded photos, videos and PDFs go to **Cloudinary** (or, alternatively, a Google Cloud Storage bucket), and sign-in uses **your own Clerk app**.

Replit keeps working unchanged: every Render-only behaviour is switched on by an environment variable Replit does not set.

## 1. Media storage: Cloudinary (recommended)

Cloudinary stores every upload: website photos, live-update videos, calendar PDFs, store photos, and the Learning portal's exam PDFs and student/staff photos.

1. Create a free account at <https://cloudinary.com> (choose the **Programmable Media** product).
2. Open **Dashboard** (or **Settings → API Keys**) and copy the **API environment variable**. It looks like `CLOUDINARY_URL=cloudinary://123456789012345:abcdEFGH...@your-cloud-name`.
3. In Render → your service → **Environment**, add `CLOUDINARY_URL` and paste only the part **after** `CLOUDINARY_URL=` (it starts with `cloudinary://`). Save; Render redeploys.
4. Sign in to `/admin`. On the dashboard, the **Media storage** card should say **Cloudinary**. Press **Test connection**: it uploads a tiny image, loads it back (publicly and privately) and deletes it.
5. Upload a real photo (for example a store product) and check it shows on the site.

How files are kept:
- **Website media** is public and served from Cloudinary's fast CDN (`res.cloudinary.com`).
- **Portal files** (exam PDFs, student and staff photos) are stored as Cloudinary *authenticated* (private) files and only reach people through the portal's permission checks.
- Everything lives under the `nwe/` folder in your Media Library. Do not rename or delete those files there, or the site will lose them.

Limits on the free plan: images and PDFs up to 10 MB, videos up to 100 MB. The site accepts videos up to 500 MB (big ones upload from the browser straight to Cloudinary in pieces), but Cloudinary only takes files above 100 MB on a paid plan. For long videos the free option is **Live updates → YouTube link**: upload to the school's YouTube channel (public or unlisted) and paste the link; it plays inside the website. If uploads stop working, the Test connection button shows Cloudinary's own error message. Never paste the API secret anywhere except Render.

If `CLOUDINARY_URL` is not set, the site uses the Google Cloud bucket below instead.

## 1b. Google Cloud Storage (alternative to Cloudinary)

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
| `CSP_REPORT_ONLY` | Leave unset: the Content-Security-Policy is enforced. `true` is an emergency switch to report-only. |

**Turning on required two-factor (in this order, so nobody is locked out):**
1. In the Clerk dashboard: *Configure → Multi-factor*, enable **Authenticator application** and **Backup codes**. (Clerk may need a paid plan for MFA on a production instance; development instances include it.)
2. Sign in to the site, open your account (top right) → *Security*, add an authenticator app and save your backup codes.
3. In Render set `REQUIRE_ADMIN_MFA=true`. Other administrators are guided through setup the next time they sign in.

**Content-Security-Policy:** enforced on every page. If something the site needs is ever blocked, Render logs show `CSP violation report` lines; set `CSP_REPORT_ONLY=true` while the policy is fixed, then remove it. The old `CSP_ENFORCE` variable is no longer used and can be deleted.

**Idle sign-out:** staff and students are signed out after 30 minutes without activity (a one-minute warning first). Students in the middle of an exam are not signed out; the exam timer decides.

**Audit log:** every staff change (who, what, when, IP address, device, before and after) and security events such as failed student sign-ins are recorded. The log is append-only and visible only to the super administrator in *Portal management → Audit log*.

## 6. Backups and restore

- **Automatic:** Render Postgres paid plans take daily backups with point-in-time recovery (*Database → Recovery*). The free plan has no backups.
- **Manual copy before risky changes:** `pg_dump --no-owner --format=custom "$RENDER_EXTERNAL_DATABASE_URL" > nwe-$(date +%F).dump`
- **Restore a manual copy into an empty database:** `pg_restore --no-owner --clean --if-exists -d "$TARGET_DATABASE_URL" nwe-YYYY-MM-DD.dump`, then point `DATABASE_URL` at it and redeploy.

## 7. Email (activation and password-reset links)

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | Your Resend API key |
| `EMAIL_FROM` | Sender on a domain verified in Resend, e.g. `New World Emerald <portal@yourdomain.com>`. `onboarding@resend.dev` works only for emails to your own Resend address. |
| `PUBLIC_SITE_URL` | Optional. The address used in emailed links, e.g. `https://www.yourdomain.com`. If empty, Render's own address (`RENDER_EXTERNAL_URL`) is used. |

How it works:
- **Enrol student** creates a Student ID automatically (`NWE/2026/00001`) and a one-time **activation link** (valid 72 hours). It is emailed to the parent when an email is given; staff can also copy it, send it by WhatsApp or print an activation slip.
- The family opens the link, checks the student's details and chooses a password (10+ characters with letters and numbers). The student is then signed in.
- **Reset link** (Students tab) and **Email a reset link** (student sign-in page) send a password-reset link valid for 24 hours. The sign-in page always gives the same reply, so it cannot reveal which Student IDs exist.
- Existing students keep their current passwords. The old **Temporary password** option remains for families without email.
- If an email cannot be sent, staff see why (for example an unverified domain) and can share the link instead.

## 8. Moving the school domain to this site (replacing the old WordPress site)

The domain's DNS is managed in **Cloudflare**. The old WordPress site and the **school email** (`mail.newworldemeraldprivateschool.com`) are on the old hosting server (`159.198.64.225`).

**Do not change** the `MX` record, the `mail` record or the SPF `TXT` record, and **do not cancel the old hosting plan** while school email runs on it.

1. **Back up the old site** first (old host's cPanel → Backup, or a WordPress backup plugin).
2. **Render** → your service → Settings → **Custom Domains** → add `newworldemeraldprivateschool.com` and `www.newworldemeraldprivateschool.com`.
3. **Cloudflare** → the domain → **DNS**:
   - Edit the root records (`@`, now `A` records to the old server): delete them and add `CNAME` `@` → `new-world-emerald-school.onrender.com`.
   - Edit `www`: `CNAME` `www` → `new-world-emerald-school.onrender.com`.
   - Set both to **DNS only** (grey cloud) so Render can issue the HTTPS certificate.
   - Optional: keep the old site reachable for reference with `A` `old` → `159.198.64.225`.
4. Wait until Render shows both domains as **Verified** with a certificate (minutes, sometimes up to an hour), then open the domain.
5. Render → **Environment**: `PUBLIC_SITE_URL=https://newworldemeraldprivateschool.com`, then `FORWARD_TO_DOMAIN=true` (sends visitors on the onrender.com address to the domain).
6. **Clerk**: for the live site, create the Clerk **production** instance for this domain (on Clerk's free plan, two-factor is not available in production: leave `REQUIRE_ADMIN_MFA` unset or `false`, and turn on **Email verification code** sign-in instead), add the DNS records Clerk lists in Cloudflare (DNS only), then replace the three Clerk keys in Render with the `pk_live_` / `sk_live_` ones. Administrators sign up once more on the production instance with their approved email.
7. **Resend**: Domains → add the domain and put its DNS records in Cloudflare (they use a `send` subdomain, so school email is unaffected). Then `EMAIL_FROM=New World Emerald <noreply@newworldemeraldprivateschool.com>`.

Old WordPress addresses (`/about-us/`, `/faqs/`, `/shop/`, `/my-account/`, blog posts, categories and theme pages) redirect to the matching part of the new site automatically.

To undo the switch, put the old `A` records back (`@` and `www` → `159.198.64.225`).

## 9. Sending Clerk's sign-in emails through Resend

Staff sign in with Clerk. Clerk's emails (verification codes, password resets, invitations) can be sent from the school's address through Resend instead of Clerk's mail service. Do the steps **in this order**, so no code is lost in between:

1. Resend must already work: `RESEND_API_KEY` and `EMAIL_FROM` set in Render, and the domain verified in Resend.
2. **Clerk** → **Configure → Webhooks** → **Add Endpoint**:
   - Endpoint URL: `https://newworldemeraldprivateschool.com/api/webhooks/clerk-email`
   - Subscribe to the event **`email.created`** only. Create it.
3. Open the new endpoint and copy its **Signing Secret** (starts with `whsec_`).
4. **Render** → **Environment**: add `CLERK_WEBHOOK_SIGNING_SECRET` with that value. Wait for the deploy.
5. In Clerk, open the endpoint's **Testing** tab and send an `email.created` test. It should show a 200 response.
6. **Clerk** → **Customization → Emails**: open each email you want Resend to send (for example *Verification code*, *Reset password code*, *Invitation*) and switch **Delivered by Clerk** off.
7. Sign out, use "Forgot password" on the staff sign-in, and check the code arrives from your school address.

If Resend refuses an email, the site answers with an error and Clerk retries it automatically; the reason appears in the Render logs ("Clerk email not sent through Resend"). To go back, switch **Delivered by Clerk** on again.

