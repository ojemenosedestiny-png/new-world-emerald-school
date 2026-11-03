# Disaster recovery: getting the school site back

What to do when newworldemeraldprivateschool.com breaks, by symptom. Work down the first table, then follow the
section it points to. Nothing here needs code changes.

## Where everything lives

| Piece | Where | Recovers from |
|---|---|---|
| Website and API code | GitHub `ojemenosedestiny-png/new-world-emerald-school`, branch `main` | Git history (every version is kept) |
| Hosting recipe | `render.yaml` in the repo (Render "Blueprint") | The repo |
| Database (students, scores, exams, fees) | Render Postgres `new-world-emerald-db` | Render daily backups and point-in-time recovery (paid database plan), plus encrypted copies made by hand |
| Photos, PDFs, signatures uploaded as files | Cloudinary | Cloudinary keeps them; they are not in the database backup |
| Sign-in accounts | Clerk | Clerk keeps them |
| Settings and keys | Render, *Environment* tab of the web service | Your own safe copy (see the checklist at the end) |
| School email | The old host (not Render) | Unaffected by anything here. Never change the MX, mail or SPF records |

## 1. Which situation is it?

| What you see | Most likely | Go to |
|---|---|---|
| Site broke right after an update was pushed | A bad deploy | **2. Roll back the code** |
| "Service unavailable" or a blank page, and no update was made | Render or the service is down | **3. Service down** |
| Site works but data is wrong or missing (deleted students, wiped scores) | A mistake in the data | **4. Restore the data** |
| Database deleted, expired or corrupted | Lost database | **5. New database from a backup** |
| Render account or service gone | Lost hosting | **6. Rebuild everything from the Blueprint** |

The hourly *Website uptime* check in GitHub (Actions tab) emails the repository owner when the home page, the API or the
database stops answering.

## 2. Roll back the code (about 2 minutes)

1. Render dashboard -> the `new-world-emerald` web service -> **Events**.
2. Find the last deploy marked *Live* before the problem -> **Rollback** (or *Redeploy* on that deploy).
3. Check the site. The database is not touched by a rollback.
4. Then fix the code properly. Until it is fixed, turn off *Auto-Deploy* (Settings), so the next push to `main` does not put the bad version back.

A deploy that would delete or rename database data stops on its own and the old site keeps running
(`scripts/render-build.sh`). That is a failed deploy, not an outage: read the deploy log.

## 3. Service down

1. Check <https://status.render.com>. If Render itself is down, wait; nothing on our side will help.
2. Render -> web service -> **Logs**. Common causes:
   - *Missing or wrong key*: the build stops with "ERROR: <NAME> is not set / has the wrong format". Fix it under **Environment**, then **Manual Deploy -> Deploy latest commit**.
   - *Database unavailable*: open the database in Render. If it is suspended or expired, see section 5.
3. **Manual Deploy -> Clear build cache & deploy** fixes most one-off build problems.

## 4. Restore the data (something was deleted or overwritten)

First check the staff portal **Audit log** (super administrator): it shows who changed what and when, and the
"before" values. A single record can often be put back by hand from there.

For anything bigger, restore a copy taken **before** the mistake. Never restore over the live database first:
restore into a new database, check it, then switch.

**A. Render point-in-time recovery (paid database plans, quickest).**
Render -> the database -> **Recovery** -> choose a time just before the mistake -> this creates a new database.
Copy its *Internal Database URL* into the web service's `DATABASE_URL` -> Save (it redeploys). Check the site,
then delete the old database once you are sure.

**B. An encrypted copy made by hand** (see *Making a backup by hand* below).
1. Take the newest `nwe-db-<time>.dump.gpg` from before the mistake.
2. Render -> **New -> PostgreSQL** (same region and version 16) -> copy its *External Database URL*.
3. On a computer with PostgreSQL client tools and gpg (or in Render's *Shell* tab), from the repo folder:
   ```bash
   TARGET_DATABASE_URL='<new database External URL>' BACKUP_PASSPHRASE='<the backup passphrase>' \
     bash scripts/restore-backup.sh nwe-db-<date>.dump.gpg
   ```
   Type `RESTORE` when asked. It restores everything or nothing, then prints the number of students, teachers,
   classes, scores, exams and payments, so you can check them against what you expect.
4. Put the new database's *Internal Database URL* into the web service's `DATABASE_URL` -> Save. The site redeploys on it.

Anything entered after that backup (up to a day) is not in it: re-enter it from the audit log or paper records.

## 5. New database from a backup

The database is gone or expired: create a new one and fill it as in **4B**, steps 2 to 4. The next deploy creates
any tables added since the backup.

## 6. Rebuild everything from the Blueprint

1. Render -> **New -> Blueprint** -> connect the GitHub repo -> it reads `render.yaml` and creates the web service and an empty database.
2. Fill in every setting marked `sync: false` from your safe copy (checklist below).
3. Restore the newest backup into the new database (section 4B, step 3, using the new database's URL).
4. Point the domain at the new service: Render -> web service -> **Settings -> Custom Domains** -> add the domain, then update the DNS record Render shows in Cloudflare. Only the website record; never MX, mail or SPF.
5. Clerk, Cloudinary, Resend and Paystack accounts are unaffected; their keys go back in as they were. In Paystack, check the webhook URL is still `https://newworldemeraldprivateschool.com/api/webhooks/paystack`.

## Keep these somewhere safe (not in GitHub, not in chat)

A password manager or a sealed document held by the school owner:

- **Backup passphrase** (`BACKUP_PASSPHRASE`). Without it the hand-made backups cannot be opened.
- The Render, GitHub, Clerk, Cloudinary, Resend, Paystack and Cloudflare logins.
- The values of these Render settings: `SCHOOL_ADMIN_EMAILS`, `SCHOOL_SUPER_ADMIN_EMAILS`, `SCHOOL_DIRECTOR_EMAILS`,
  `SCHOOL_PRINCIPAL_EMAILS`, `SCHOOL_PRIMARY_PRINCIPAL_EMAILS`, `REQUIRE_ADMIN_MFA`, `RESEND_API_KEY`, `EMAIL_FROM`,
  `PAYSTACK_SECRET_KEY`, `PUBLIC_SITE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`,
  `CLERK_WEBHOOK_SIGNING_SECRET`, `CLOUDINARY_URL`, `FORWARD_TO_DOMAIN`.

Once a term, practise: take the newest backup and restore it into a new throwaway Render database (4B), check the
counts, then delete that database. A backup is only proven when it has been restored.

## Making a backup by hand

Before any risky change (a big import, a schema change, the end of a term), take your own copy as well. On a computer
with PostgreSQL client tools and gpg, from the repo folder:

```bash
DATABASE_URL='<Render database External URL>' BACKUP_PASSPHRASE='<a long secret phrase>' bash scripts/backup-db.sh backups
```

It writes `backups/nwe-db-<time>.dump.gpg`, encrypted (AES-256). Keep it off GitHub: a school laptop, a USB drive or
the school's private cloud storage. Keep the passphrase in the safe place above; without it the copy cannot be opened.
