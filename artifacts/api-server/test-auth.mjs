import { build } from "esbuild";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const directory = await mkdtemp(join(tmpdir(), "school-auth-tests-"));
try {
  const tests = ["website-admin", "school-identity", "report-cards", "security", "accounts", "community", "cloudinary", "site-redirects", "clerk-email-webhook", "live-updates", "learning", "messages", "fees", "cbt", "director", "pdf-import", "inventory", "admissions", "result-import", "facilities"];
  // pdfjs is loaded from this package at run time, as in the server build.
  await symlink(fileURLToPath(new URL("./node_modules", import.meta.url)), join(directory, "node_modules"), "junction");
  await build({
    entryPoints: tests.map((name) => fileURLToPath(new URL(`./src/lib/${name}.test.ts`, import.meta.url))),
    outdir: directory, bundle: true, platform: "node", format: "esm",
    outExtension: { ".js": ".mjs" },
    external: ["pdfjs-dist", "pdfjs-dist/*"],
    // CommonJS dependencies (e.g. Clerk) need require; resolve them from this package.
    banner: { js: `import { createRequire as __createRequire } from "node:module"; const require = __createRequire(${JSON.stringify(fileURLToPath(new URL("./package.json", import.meta.url)))});` },
  });
  const result = spawnSync(process.execPath, ["--test", ...tests.map((name) => join(directory, `${name}.test.mjs`))], { cwd: new URL(".", import.meta.url), stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}