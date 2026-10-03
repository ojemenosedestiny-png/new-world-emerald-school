// Never substitute Clerk's native auth.userId here: migrated school rows use
// the original subject preserved in the managed userId session claim.
export function schoolUserId(claims: Record<string, unknown> | null | undefined): string | null {
  return typeof claims?.userId === "string" && claims.userId.length > 0 ? claims.userId : null;
}