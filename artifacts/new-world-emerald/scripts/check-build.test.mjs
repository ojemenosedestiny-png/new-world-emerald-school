import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { test } from "node:test";
import { checkBuild } from "./check-build.mjs";

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "homepage-build-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, ".vite"));
  const manifest = {
    "index.html": { file: "entry.js", isEntry: true, imports: ["shared", "branch"], dynamicImports: [] },
    shared: { file: "shared.js", imports: ["index.html"] },
    branch: { file: "branch.js", imports: ["shared"] },
  };
  const files = ["entry.js", "shared.js", "branch.js"];
  for (const page of ["Admin", "Account", "SchoolCommerce", "SchoolSignIn"]) {
    const key = `src/pages/${page}.tsx`;
    manifest[key] = { file: `${page}.js`, isDynamicEntry: true };
    manifest["index.html"].dynamicImports.push(key);
    // A large deferred file must not count against the homepage budget.
    writeFileSync(path.join(dir, `${page}.js`), randomBytes(230_000));
  }
  for (const file of files) writeFileSync(path.join(dir, file), file.repeat(20));
  const save = () => writeFileSync(path.join(dir, ".vite/manifest.json"), JSON.stringify(manifest));
  save();
  return { dir, manifest, files, save };
}

test("counts static imports once, including transitive imports, but not dynamic imports", (t) => {
  const { dir, files } = fixture(t);
  const result = checkBuild(dir);
  assert.deepEqual(result.initialFiles.sort(), files.sort());
  assert.equal(result.gzipBytes, files.reduce((sum, file) =>
    sum + gzipSync(file.repeat(20)).byteLength, 0));
});

test("rejects initial JavaScript above the gzip budget", (t) => {
  const { dir } = fixture(t);
  writeFileSync(path.join(dir, "shared.js"), randomBytes(230_000));
  assert.throws(() => checkBuild(dir), /Reduce initial imports/);
});

for (const page of ["Admin", "Account", "SchoolCommerce", "SchoolSignIn"]) {
  test(`rejects ${page} when no longer dynamic or statically imported`, (t) => {
    const { dir, manifest, save } = fixture(t);
    const key = `src/pages/${page}.tsx`;
    manifest[key].isDynamicEntry = false;
    save();
    assert.throws(() => checkBuild(dir), /must remain a dynamic entry/);
    manifest[key].isDynamicEntry = true;
    manifest.shared.imports.push(key);
    save();
    assert.throws(() => checkBuild(dir), /leaked into the homepage/);
  });
}

test("fails closed for missing manifest entries and missing built files", (t) => {
  const { dir, manifest, save } = fixture(t);
  manifest.shared.imports.push("missing");
  save();
  assert.throws(() => checkBuild(dir), /Missing manifest chunk/);
  manifest.shared.imports.pop();
  manifest.shared.file = "missing.js";
  save();
  assert.throws(() => checkBuild(dir), /ENOENT/);
  delete manifest["index.html"];
  save();
  assert.throws(() => checkBuild(dir), /Missing index.html entry/);
});
