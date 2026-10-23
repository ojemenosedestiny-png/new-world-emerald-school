import { build } from "esbuild";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const directory = await mkdtemp(join(tmpdir(), "school-portal-tests-"));
try {
  await symlink(new URL("./node_modules", import.meta.url).pathname, join(directory, "node_modules"), "dir");
  const filename = join(directory, "portal.test.mjs");
  await build({
    entryPoints: [new URL("./src/lib/portal.test.ts", import.meta.url).pathname],
    outfile: filename, bundle: true, platform: "node", format: "esm",
    external: ["pdfjs-dist", "pdfjs-dist/*", "@google-cloud/*", "google-auth-library"],
    banner: { js: `import { createRequire as __createRequire } from "node:module"; const require = __createRequire(${JSON.stringify(new URL("./package.json", import.meta.url).pathname)});` },
  });
  // Resolve external packages from the app rather than the temporary output.
  const result = spawnSync(process.execPath, ["--test", filename], { cwd: new URL(".", import.meta.url), stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
