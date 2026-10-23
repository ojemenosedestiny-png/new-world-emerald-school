# New World Emerald Private School

School website with an approved-administrator panel for admissions, content and school commerce.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm run test:api-regeneration` — regenerate twice in a disposable workspace, check public API exports and cookie auth, and verify the standalone frontend typecheck rebuilds declarations from clean outputs (requires installed dependencies; no services or credentials needed)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Authentication: Replit-managed Clerk, email sign-in, same-origin session cookies.
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

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
- `pnpm --filter @workspace/api-server run test:portal` runs isolated synthetic portal API checks and cleans its own development data. Never seed privileged Clerk/browser identities or change the actual school approval list for testing.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
