import { clerkClient } from "@clerk/express";
import { logger } from "./logger";

// Managed session claims contain the primary email, but not its verification
// status. Resolve verification in the background, never on the request path.
let identities = new Map<string, string>();
let refreshedAt = 0;
let refreshing = false;

export function approvedEmails(): string[] {
  return (process.env.SCHOOL_ADMIN_EMAILS ?? "")
    .split(/[,;\s]+/).map((value) => value.trim().toLowerCase()).filter(Boolean);
}

export function hasVerifiedApproval(id: string, email: string | null): boolean {
  return Date.now() - refreshedAt < 120_000 &&
    email !== null && identities.get(id) === email.trim().toLowerCase();
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const next = new Map<string, string>();
    // Paginate per address so no approved identity is silently omitted.
    for (const email of approvedEmails()) {
      for (let offset = 0; ; offset += 100) {
        const result = await clerkClient.users.getUserList({ emailAddress: [email], limit: 100, offset });
        for (const user of result.data) {
          const primary = user.emailAddresses.find((item) => item.id === user.primaryEmailAddressId);
          if (primary?.verification?.status === "verified" &&
              primary.emailAddress.trim().toLowerCase() === email) {
            next.set(user.externalId ?? user.id, email);
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

export function startApprovedIdentityRefresh() {
  void refresh();
  setInterval(() => void refresh(), 60_000).unref();
}