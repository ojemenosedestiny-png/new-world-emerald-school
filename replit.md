# New World Emerald Private School

School website with an approved-administrator panel for admissions, content and school commerce.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port from `PORT`; 8080 on Replit)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm run test:api-regeneration` — regenerate twice in a disposable workspace, check public API exports and cookie auth, and verify the standalone frontend typecheck rebuilds declarations from clean outputs (requires installed dependencies; no services or credentials needed)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run test:auth` / `test:storage` — API unit tests (no services needed)
- `pnpm --filter @workspace/new-world-emerald run test:photo-entry` — all frontend vitest suites
- `pnpm --filter @workspace/new-world-emerald run check:build` — production build plus initial-JS budget and lazy-route check
- Required env: `DATABASE_URL` — Postgres connection string
- CI: `.github/workflows/ci.yml` runs typecheck, the tests above, both builds and `test:api-regeneration` on pushes to `main` and on pull requests

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Authentication: Replit-managed Clerk, email sign-in, same-origin session cookies.
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/new-world-emerald` — public website, `/admin`, `/portal` (React + Vite; routes in `src/AppRoutes.tsx`)
- `artifacts/api-server` — Express API under `/api`; routers in `src/routes`, website admin guard in `src/lib/website-admin.ts`, portal auth in `src/lib/portal-auth.ts`
- `lib/db/src/schema` — source of truth for the database schema (Drizzle)
- `lib/api-spec/openapi.yaml` + `portal.yaml` — source of truth for API contracts; `lib/api-zod` and `lib/api-client-react/src/generated` are generated from them
- `artifacts/mockup-sandbox` — Replit design canvas, not part of the live site
- `scripts/src/with-env.mjs` — cross-platform `KEY=value command` helper used by package scripts

## Architecture decisions

- Existing local user IDs and foreign keys remain unchanged. Clerk sessionClaims.userId bridges migrated accounts to school data.
- SCHOOL_ADMIN_EMAILS remains the sole website-administrator approval list; signup and first login never grant website management access. Portal teachers have separate, class-scoped approval and do not become website administrators.
- Administrator verification is refreshed from Clerk in the background because managed session claims omit email verification status. Access fails closed when verification is unavailable or stale.
- Keep Clerk's required email verification enabled. Admin sign-in returns to /admin; portal staff use the allowlisted ?returnTo=portal flow to /portal/manage. Sign-out returns to the public homepage.
- The public homepage remains available even while signed in so administrators can preview published content. Only the sign-in flow redirects to /admin.

## Product

### School learning portal

- Students open `/portal` and use a school-issued ID and an individual password. First login and staff password resets require the student to change the temporary password. Student sessions are separate from Clerk.
- Approved school administrators open `/portal/manage` (also linked from `/admin`), create classes, enrol students, and approve teacher emails with class assignments. Teachers use existing verified Clerk email sign-in and may manage only their assigned classes.
- Staff create scheduled, timed exams with multiple-choice and written questions. Multiple-choice scoring is automatic; staff mark written work and release results after the exam window closes. A started exam's content is frozen; each student has one resumable attempt.
- PDF upload accepts up to 15MB and drafts numbered text-based questions for review. It never guesses answer keys. Scanned papers and complex layouts can use the original-PDF mode with bulk answer slots; OCR is not included. Do not publish original exam papers containing an answer key.
- Revision notes/PDFs and announcements are class-scoped. Student results, exam keys, private PDFs and saved answers must not be exposed through public website storage routes.
- Staff open **Results** on any exam for live progress (not started / writing with time left / awaiting marking / marked), class statistics (average, highest, lowest, pass rate at 50%) and a CSV export. Staff can give a student who is still writing 5–240 extra minutes; the extension applies to that student only and may run past the exam window. Approved administrators can reset an attempt (deletes the answers so the student can start again while the exam is open). Both are blocked while results are released.
- Exams no student has started, revision notes and announcements can be deleted. Started exams can only be hidden.
- Students see their average across released results on the Results tab; unreleased scores are never included.
- `pnpm --filter @workspace/api-server run test:portal-control` runs database-only checks for the staff controls (needs `DATABASE_URL` pointing at a disposable database; CI runs it against a throwaway Postgres).
- `pnpm --filter @workspace/api-server run test:portal` runs isolated synthetic portal API checks and cleans its own development data. Never seed privileged Clerk/browser identities or change the actual school approval list for testing.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Website API routes are private by default. `protectWebsiteManagement` only lets through the public endpoints listed in `src/lib/website-admin.ts`; a new public endpoint must be added there (and to `website-admin.test.ts`). Portal routes use their own role checks.
- `requireAuthentication` only checks sign-in, not admin approval. Use `requireWebsiteAdmin` when a route needs an administrator.
- After editing the OpenAPI spec, run codegen and commit the generated files. Never hand-edit `generated/` folders. `lib/api-client-react/src/index.ts` is hand-maintained; keep each export once.
- Schema changes go through `drizzle-kit push` (no migration files) and `scripts/post-merge.sh` pushes automatically after merges. Make changes additive (new nullable columns/tables); plan renames and drops by hand with a backup first. Never run `push-force` against production.
- Security: every staff POST/PUT/PATCH/DELETE is written to `portal_audit_log` by `auditStaffChanges` (before snapshots for portal commands, secrets redacted). Super administrator = `SCHOOL_SUPER_ADMIN_EMAILS` or the first admin email. `REQUIRE_ADMIN_MFA=true` requires Clerk two-factor for admins (pending admins get no staff access). The CSP is report-only until `CSP_ENFORCE=true`; print windows must not use inline scripts.
- Use pnpm 10 (the lockfile is v9 format). pnpm 12 rejects the `onlyBuiltDependencies` setting.
- Local development on Windows works for typecheck, tests and builds. The API server and `test:portal` also need `DATABASE_URL` and Clerk keys.

## Pointers

- Deploying outside Replit: `docs/DEPLOY-RENDER.md` (`render.yaml`, `scripts/render-build.sh`). Render-only behaviour is enabled by `FRONTEND_DIST_DIR` and `GCS_SERVICE_ACCOUNT_JSON`, which Replit leaves unset.

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
