import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const directory = await mkdtemp(join(tmpdir(), "school-auth-tests-"));
try {
  const tests = ["website-admin", "school-identity"];
  await build({
    entryPoints: tests.map((name) => new URL(`./src/lib/${name}.test.ts`, import.meta.url).pathname),
    outdir: directory, bundle: true, platform: "node", format: "esm",
    outExtension: { ".js": ".mjs" },
  });
  const result = spawnSync(process.execPath, ["--test", ...tests.map((name) => join(directory, `${name}.test.mjs`))], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}