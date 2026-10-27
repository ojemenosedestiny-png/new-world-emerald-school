import { clerkClient } from "@clerk/express";
import { logger } from "./logger";

// Managed session claims contain the primary email, but not its verification
// status. Resolve verification in the background, never on the request path.
type Identity = { email: string; mfa: boolean };
let identities = new Map<string, Identity>();
let refreshedAt = 0;
let refreshing = false;

export function approvedEmails(): string[] {
  return (process.env.SCHOOL_ADMIN_EMAILS ?? "")
    .split(/[,;\s]+/).map((value) => value.trim().toLowerCase()).filter(Boolean);
}

/** Super administrators; defaults to the first approved administrator email. */
export function superAdminEmails(): string[] {
  const explicit = (process.env.SCHOOL_SUPER_ADMIN_EMAILS ?? "").split(/[,;\s]+/).map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (explicit.length) return explicit.filter((e) => approvedEmails().includes(e));
  const first = approvedEmails()[0];
  return first ? [first] : [];
}

/**
 * The Director: the only account that can open the Director dashboard and receive the weekly report.
 * Set in SCHOOL_DIRECTOR_EMAILS; must also be an approved administrator. No default: unset means nobody.
 */
export function directorEmails(): string[] {
  const listed = (process.env.SCHOOL_DIRECTOR_EMAILS ?? "").split(/[,;\s]+/).map((v) => v.trim().toLowerCase()).filter(Boolean);
  return listed.filter((e) => approvedEmails().includes(e));
}

/** When true, administrators must have Clerk two-factor authentication turned on. */
export const adminMfaRequired = () => process.env.REQUIRE_ADMIN_MFA === "true";

function current(id: string, email: string | null): Identity | undefined {
  if (Date.now() - refreshedAt >= 120_000 || email === null) return undefined;
  const identity = identities.get(id);
  return identity && identity.email === email.trim().toLowerCase() ? identity : undefined;
}

export function hasVerifiedApproval(id: string, email: string | null): boolean {
  return current(id, email) !== undefined;
}

export function hasAdminMfa(id: string, email: string | null): boolean {
  return current(id, email)?.mfa === true;
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const next = new Map<string, Identity>();
    // Paginate per address so no approved identity is silently omitted.
    for (const email of approvedEmails()) {
      for (let offset = 0; ; offset += 100) {
        const result = await clerkClient.users.getUserList({ emailAddress: [email], limit: 100, offset });
        for (const user of result.data) {
          const primary = user.emailAddresses.find((item) => item.id === user.primaryEmailAddressId);
          if (primary?.verification?.status === "verified" &&
              primary.emailAddress.trim().toLowerCase() === email) {
            next.set(user.externalId ?? user.id, { email, mfa: user.twoFactorEnabled === true });
          }
        }
        if (offset + result.data.length >= result.totalCount || result.data.length === 0) break;
      }
    }
    identities = next;
    refreshedAt = Date.now();
  } catch (error) {
    // Fail closed: a stale or unavailable verification registry grants no access.
    identities = new Map();
    logger.error({ err: error }, "Unable to refresh administrator identity verification");
  } finally {
    refreshing = false;
  }
}

let lastOnDemand = 0;
/** Refreshes sooner after an administrator turns on two-factor, at most every 10 seconds. */
export function refreshApprovedIdentitiesSoon() {
  if (Date.now() - lastOnDemand < 10_000) return;
  lastOnDemand = Date.now();
  void refresh();
}

export function startApprovedIdentityRefresh() {
  void refresh();
  setInterval(() => void refresh(), 60_000).unref();
}

/** Test hook: seeds the registry without Clerk. */
export function setApprovedIdentitiesForTest(entries: [string, Identity][]) {
  identities = new Map(entries);
  refreshedAt = Date.now();
}
