// Imported first by index.ts so it runs before Clerk loads: no usage data is sent to
// Clerk and the "Clerk collects telemetry" notice stays out of the server logs.
process.env.CLERK_TELEMETRY_DISABLED ??= "1";
export {};
