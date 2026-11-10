import { clerkClient } from "@clerk/express";
import { logger } from "./logger";

// Managed session claims contain the primary email, but not its verification
// status. Resolve verification in the background, never on the request path.
type Identity = { email: string; mfa: boolean };
let identities = new Map<string, Identity>();
let refreshedAt = 0;
let refreshing = false;

/**
 * The emails in a Render setting. Forgiving of how they were pasted: commas, semicolons, spaces or new lines between
 * them, quote marks or angle brackets around them, capitals, and a stray "NAME=" in front.
 */
export function emailList(raw: string | undefined): string[] {
  return (raw ?? "").replace(/^\s*[A-Z_]+\s*=\s*/, "").split(/[,;\s]+/)
    .map((v) => v.replace(/^["'<(]+|[>"')]+$/g, "").trim().toLowerCase())
    .filter((v) => v.includes("@"));
}

export function approvedEmails(): string[] {
  const admins = emailList(process.env.SCHOOL_ADMIN_EMAILS);
  // The Head of School is always an administrator too.
  return [...new Set([...admins, ...headEmails()])];
}

/**
 * The Head of School (SCHOOL_HEAD_EMAILS): sees and acts everywhere (the office, both principal portals, the exam
 * officer's portal and the Director's dashboard) and emails teachers and parents. No default: unset means nobody.
 */
export function headEmails(): string[] {
  return emailList(process.env.SCHOOL_HEAD_EMAILS);
}

/** Super administrators; defaults to the first approved administrator email. */
export function superAdminEmails(): string[] {
  const explicit = emailList(process.env.SCHOOL_SUPER_ADMIN_EMAILS);
  if (explicit.length) return explicit.filter((e) => approvedEmails().includes(e));
  const first = approvedEmails()[0];
  return first ? [first] : [];
}

/**
 * The Director: the only account that can open the Director dashboard and receive the weekly report.
 * Set in SCHOOL_DIRECTOR_EMAILS; must also be an approved administrator. No default: unset means nobody.
 */
export function directorEmails(): string[] {
  const listed = emailList(process.env.SCHOOL_DIRECTOR_EMAILS);
  return listed.filter((e) => approvedEmails().includes(e));
}

/**
 * The secondary principal (SCHOOL_PRINCIPAL_EMAILS, JSS 1 to SS 3) and the primary principal
 * (SCHOOL_PRIMARY_PRINCIPAL_EMAILS, Year 1 to Year 6): each opens their own principal portal to assign teachers
 * to classes and see teachers' daily activity. They need not be administrators: a principal listed only here gets
 * their own portal and nothing else (least privilege). No default: unset means nobody.
 */
export function principalEmails(section: "primary" | "secondary" = "secondary"): string[] {
  return emailList(process.env[section === "primary" ? "SCHOOL_PRIMARY_PRINCIPAL_EMAILS" : "SCHOOL_PRINCIPAL_EMAILS"]);
}

/**
 * The exam officer (SCHOOL_EXAM_OFFICER_EMAILS): the final step before any exam reaches students. When set, teachers,
 * principals and the office send exams to the exam officer, who publishes or returns them. Not an administrator.
 */
export function examOfficerEmails(): string[] {
  return emailList(process.env.SCHOOL_EXAM_OFFICER_EMAILS);
}

/**
 * The Chairman of the board (SCHOOL_CHAIRMAN_EMAILS): sees the read-only board of the whole school. Not an
 * administrator: cannot change anything, send anything or see money.
 */
export function chairmanEmails(): string[] {
  return emailList(process.env.SCHOOL_CHAIRMAN_EMAILS);
}

/** Every email whose Clerk verification is tracked: administrators, both principals, the exam officer and the Chairman. */
export function verifiedRoleEmails(): string[] {
  return [...new Set([...approvedEmails(), ...principalEmails("secondary"), ...principalEmails("primary"), ...examOfficerEmails(), ...chairmanEmails()])];
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
    for (const email of verifiedRoleEmails()) {
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
