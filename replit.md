# New World Emerald Private School

School website with an approved-administrator panel for admissions, content and school commerce.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
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
- SCHOOL_ADMIN_EMAILS remains the sole approval list; signup and first login never grant management access.
- Administrator verification is refreshed from Clerk in the background because managed session claims omit email verification status. Access fails closed when verification is unavailable or stale.
- Keep Clerk's required email verification enabled. Admin sign-in returns to /admin; sign-out returns to the public homepage.
- The public homepage remains available even while signed in so administrators can preview published content. Only the sign-in flow redirects to /admin.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
