# New World Emerald Private School

The school's public website, school office admin, Learning portal (staff) and student portal, live at **https://newworldemeraldprivateschool.com**.

- **Architecture and handover:** `docs/ARCHITECTURE.pdf`
- **Hosting, domain and accounts setup:** [docs/DEPLOY-RENDER.md](docs/DEPLOY-RENDER.md)
- **Environment variables:** [.env.example](.env.example)

## What is where

| Path | What it is |
|---|---|
| `artifacts/new-world-emerald` | Website and all screens (React 19, Vite, Tailwind). Public site, `/admin`, `/portal` (students), `/portal/manage` (staff). |
| `artifacts/api-server` | API and web server (Express 5). Serves the built website too, as one Render service. |
| `lib/db` | Database tables (PostgreSQL with Drizzle ORM). |
| `lib/api-spec` | The API contract (OpenAPI YAML). Change it first, then run codegen. |
| `lib/api-zod`, `lib/api-client-react` | Generated from the contract: request validators for the server, React Query hooks for the screens. Do not edit by hand. |
| `scripts/render-build.sh` | Render's build: checks key formats, installs, updates the database schema, builds. |
| `.github/workflows/ci.yml` | Automatic checks on every push to `main`, `portal-upgrade` and the deploy branch. |

## Daily commands

Use pnpm 10 (newer versions reject the workspace settings): `npx -y pnpm@10.34.7 <command>`.

```bash
pnpm install
pnpm run typecheck                                        # every package
pnpm --filter @workspace/api-spec run codegen              # after changing lib/api-spec/*.yaml
pnpm --filter @workspace/db run push                       # apply table changes (needs DATABASE_URL)
pnpm --filter @workspace/api-server run test:auth          # API unit tests
pnpm --filter @workspace/api-server run test:storage       # upload and file tests
pnpm --filter @workspace/new-world-emerald run test:photo-entry   # all screen tests
pnpm --filter @workspace/new-world-emerald run check:build       # build + homepage size budget
```

Database tests (need a throwaway Postgres in `DATABASE_URL`, never the live database):
`test:portal-control`, `test:portal-reports`, `test:portal-security`, `test:portal-accounts`, `test:portal-community`, `test:portal-media`, `test:media-storage`.

## How changes reach the live site

1. Work on a branch, run the checks above, commit.
2. Push. Render deploys the branch it is set to (currently `chore/hardening-and-tooling`) automatically.
3. Render's build runs `scripts/render-build.sh`, which also applies database table changes. Table changes must only add things (new tables, new columns with defaults), never drop or rename, because they run against live data.

## Rules that keep it safe

- No keys or passwords in the code. The repository is public. Keys live only in Render → Environment.
- Every API change starts in `lib/api-spec`, then codegen; the server validates every request with the generated validators.
- Website management routes are private unless listed as public in `artifacts/api-server/src/lib/website-admin.ts` (fail closed).
- School email runs on the old hosting server: never change the `mail`, `MX` or SPF records in Cloudflare.
