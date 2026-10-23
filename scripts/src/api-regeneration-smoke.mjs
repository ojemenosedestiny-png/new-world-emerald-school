import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Run from any working directory. Never install packages or regenerate in the
// real workspace: only installed third-party dependencies are shared read-only.
const root = fileURLToPath(new URL("../../", import.meta.url));
const scratch = mkdtempSync(path.join(tmpdir(), "school-api-regeneration-"));
const frontend = "artifacts/new-world-emerald";
const client = "lib/api-client-react";
const ts = createRequire(path.join(root, "package.json"))("typescript");
const ignored = new Set(["node_modules", "dist", "build", ".cache", ".vite"]);

function copy(relative) {
  cpSync(path.join(root, relative), path.join(scratch, relative), {
    recursive: true,
    filter: (source) =>
      !ignored.has(path.basename(source)) && !source.endsWith(".tsbuildinfo"),
  });
}

// A simple node_modules directory symlink would resolve @workspace packages
// back into the real checkout, hiding stale declarations and risking writes.
function linkDependencies(source, destination) {
  if (!existsSync(source)) return;
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".cache" || entry.name === ".vite") continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory() && entry.name.startsWith("@")) {
      linkDependencies(from, to);
      continue;
    }
    const resolved = realpathSync(from);
    const relative = path.relative(root, resolved);
    const isWorkspacePackage =
      /^(lib|artifacts)[/\\]/.test(relative) &&
      !relative.split(path.sep).includes("node_modules");
    const target = isWorkspacePackage
      ? path.join(scratch, relative)
      : resolved;
    assert.ok(existsSync(target), `Missing copied dependency: ${relative}`);
    symlinkSync(target, to);
  }
}

function run(args) {
  console.info(`\n[api-regeneration] pnpm ${args.join(" ")}`);
  const result = spawnSync("pnpm", args, {
    cwd: scratch,
    stdio: "inherit",
    timeout: 180_000,
    env: { ...process.env, CI: "true" },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Command failed: pnpm ${args.join(" ")}`);
}

function snapshot(directory) {
  const result = {};
  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        result[path.relative(directory, absolute)] = createHash("sha256")
          .update(readFileSync(absolute))
          .digest("hex");
      }
    }
  }
  visit(directory);
  return result;
}

function assertUniqueBarrel() {
  const source = ts.createSourceFile(
    "index.ts",
    readFileSync(path.join(scratch, client, "src/index.ts"), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const seen = new Set();
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    const clause = statement.exportClause;
    const keys = clause && ts.isNamedExports(clause)
      ? clause.elements.map((element) => `name:${element.name.text}`)
      : [`star:${statement.moduleSpecifier?.text}`];
    for (const key of keys) {
      assert.ok(!seen.has(key), `Duplicate barrel export: ${key}`);
      seen.add(key);
    }
  }
}

function cleanBuildOutputs(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.name === "dist" || entry.name.endsWith(".tsbuildinfo")) {
      rmSync(absolute, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      cleanBuildOutputs(absolute);
    }
  }
}

const originalLibraries = snapshot(path.join(root, "lib"));
try {
  for (const relative of [
    "package.json", "pnpm-workspace.yaml", "tsconfig.json", "tsconfig.base.json",
    "lib",
  ]) copy(relative);
  // No school photos, uploads, environment files, or production services needed.
  mkdirSync(path.join(scratch, frontend), { recursive: true });
  for (const relative of [
    "package.json", "tsconfig.json", "vitest.config.ts", "src", "tests",
  ]) copy(`${frontend}/${relative}`);

  linkDependencies(path.join(root, "node_modules"), path.join(scratch, "node_modules"));
  for (const pkg of [
    "lib/api-spec", client, "lib/api-zod", "lib/db", frontend,
  ]) {
    linkDependencies(path.join(root, pkg, "node_modules"), path.join(scratch, pkg, "node_modules"));
  }
  assert.equal(
    realpathSync(path.join(scratch, frontend, "node_modules/@workspace/api-client-react")),
    path.join(scratch, client),
    "Frontend must resolve the isolated API client, not the real checkout",
  );
  const barrel = path.join(scratch, client, "src/index.ts");
  const mutator = path.join(scratch, client, "src/custom-fetch.ts");
  const originalBarrel = readFileSync(barrel, "utf8");
  const originalMutator = readFileSync(mutator, "utf8");
  assertUniqueBarrel();
  // Missing generated sources must be recreated, not silently reused.
  for (const pkg of [client, "lib/api-zod"]) {
    rmSync(path.join(scratch, pkg, "src/generated"), { recursive: true, force: true });
  }
  let firstBarrel;
  for (let pass = 1; pass <= 2; pass++) {
    run(["--filter", "@workspace/api-spec", "run", "codegen"]);
    assertUniqueBarrel();
    const currentBarrel = readFileSync(barrel, "utf8");
    assert.equal(currentBarrel, originalBarrel, "Generation changed the public barrel");
    if (pass === 1) firstBarrel = currentBarrel;
    else assert.equal(currentBarrel, firstBarrel, "Repeated generation changed the barrel");
    assert.equal(readFileSync(mutator, "utf8"), originalMutator, "Generation changed custom fetch/auth behavior");
  }

  // Compile imports through the public barrel (including the type-only export).
  // Keeping this in src makes the real frontend typecheck validate the fixture.
  writeFileSync(path.join(scratch, frontend, "src/api-regeneration-smoke.ts"), `
import {
  customFetch, ApiError, setBaseUrl, setAuthTokenGetter,
  useGetLocalAccount, getGetLocalAccountQueryKey,
  type AuthTokenGetter,
} from "@workspace/api-client-react";
const tokenGetter: AuthTokenGetter = () => null;
const configureAuth: (getter: AuthTokenGetter | null) => void = setAuthTokenGetter;
const configureBase: (url: string | null) => void = setBaseUrl;
export const smokeExports = {
  customFetch, ApiError, configureAuth, configureBase, tokenGetter,
  useGetLocalAccount, getGetLocalAccountQueryKey,
};
`);
  // Codegen builds declarations itself. Remove those AND incremental metadata
  // before checking the standalone frontend command, so that cannot mask a gap.
  cleanBuildOutputs(path.join(scratch, "lib"));
  cleanBuildOutputs(path.join(scratch, frontend));
  assert.ok(!existsSync(path.join(scratch, client, "dist")));
  assert.ok(!existsSync(path.join(scratch, client, "tsconfig.tsbuildinfo")));
  run(["--filter", "@workspace/new-world-emerald", "run", "typecheck"]);
  for (const declaration of [
    "index.d.ts", "custom-fetch.d.ts", "generated/api.d.ts", "generated/api.schemas.d.ts",
  ]) {
    assert.ok(existsSync(path.join(scratch, client, "dist", declaration)),
      `Frontend typecheck did not prepare ${declaration}`);
  }
  run(["--filter", "@workspace/new-world-emerald", "run", "test:api-client"]);
  console.info("\nAPI regeneration smoke check passed: exports, idempotence, clean declarations, and cookie auth.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
  assert.deepEqual(snapshot(path.join(root, "lib")), originalLibraries,
    "Smoke check modified libraries in the real checkout");
}
