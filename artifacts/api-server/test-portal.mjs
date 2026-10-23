import { build } from "esbuild";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Defaults to the full portal suite; `node test-portal.mjs portal-control` runs the database-only suite.
const suite = process.argv[2] ?? "portal";
const directory = await mkdtemp(join(tmpdir(), "school-portal-tests-"));
try {
  await symlink(fileURLToPath(new URL("./node_modules", import.meta.url)), join(directory, "node_modules"), "junction");
  const filename = join(directory, `${suite}.test.mjs`);
  await build({
    entryPoints: [fileURLToPath(new URL(`./src/lib/${suite}.test.ts`, import.meta.url))],
    outfile: filename, bundle: true, platform: "node", format: "esm",
    external: ["pdfjs-dist", "pdfjs-dist/*", "@google-cloud/*", "google-auth-library"],
    banner: { js: `import { createRequire as __createRequire } from "node:module"; const require = __createRequire(${JSON.stringify(fileURLToPath(new URL("./package.json", import.meta.url)))});` },
  });
  // Resolve external packages from the app rather than the temporary output.
  const result = spawnSync(process.execPath, ["--test", filename], { cwd: new URL(".", import.meta.url), stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
