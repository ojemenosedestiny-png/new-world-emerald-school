import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// Decimal kB, matching Vite's gzip report. Baseline: ~209.5 kB of initial
// JavaScript; 220 kB allows ~5% headroom, not an extra deferred page.
// CSS, images and dynamicImports are intentionally outside this JS budget.
export const BASELINE_GZIP_BYTES = 209_500;
export const MAX_INITIAL_GZIP_BYTES = 220_000;
const deferredPages = ["Admin", "Account", "SchoolCommerce", "SchoolSignIn"];
const defaultDist = fileURLToPath(new URL("../dist/public/", import.meta.url));

export function checkBuild(distDir = defaultDist) {
  const manifest = JSON.parse(
    readFileSync(path.join(distDir, ".vite/manifest.json"), "utf8"),
  );
  const entry = manifest["index.html"];
  if (!entry?.isEntry) throw new Error("Missing index.html entry in Vite manifest");

  // Walk only static imports, handling shared dependencies and cycles once.
  const visited = new Set();
  const initialFiles = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    const chunk = manifest[key];
    if (!chunk?.file) throw new Error(`Missing manifest chunk: ${key}`);
    visited.add(key);
    if (chunk.file.endsWith(".js")) initialFiles.add(chunk.file);
    for (const imported of chunk.imports ?? []) visit(imported);
  }
  visit("index.html");

  for (const page of deferredPages) {
    const key = `src/pages/${page}.tsx`;
    const chunk = manifest[key];
    if (!chunk?.isDynamicEntry) {
      throw new Error(`${page} must remain a dynamic entry (${key})`);
    }
    if (visited.has(key) || initialFiles.has(chunk.file)) {
      throw new Error(`${page} leaked into the homepage's static import graph`);
    }
  }

  let gzipBytes = 0;
  for (const file of initialFiles) {
    // Compress each served file separately, as Vite does (default gzip level).
    gzipBytes += gzipSync(readFileSync(path.join(distDir, file))).byteLength;
  }
  const summary = `Initial JS: ${(gzipBytes / 1000).toFixed(2)} kB gzip across ${initialFiles.size} files; baseline ${(BASELINE_GZIP_BYTES / 1000).toFixed(1)} kB, limit ${(MAX_INITIAL_GZIP_BYTES / 1000).toFixed(1)} kB`;
  if (gzipBytes > MAX_INITIAL_GZIP_BYTES) {
    throw new Error(`${summary}. Reduce initial imports before raising the budget.`);
  }
  return { gzipBytes, initialFiles: [...initialFiles], summary };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(checkBuild().summary);
    console.log("Deferred page isolation: Admin, Account, SchoolCommerce, SchoolSignIn OK");
  } catch (error) {
    console.error(`Build performance check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
