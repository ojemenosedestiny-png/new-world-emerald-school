// After the build: every package the bundled server imports (the ones build.mjs leaves external) must resolve from
// dist/, exactly as it will on Render. Catches a dependency that is only present by accident (a transitive install)
// before a deploy crashes on start-up with ERR_MODULE_NOT_FOUND.
import { readFile, readdir } from "node:fs/promises";
import { createRequire, builtinModules } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const dist = fileURLToPath(new URL("./dist/", import.meta.url));
const files = (await readdir(dist)).filter((f) => f.endsWith(".mjs"));
if (!files.length) { console.error("No built server in dist/. Run the build first."); process.exit(1); }
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
const specifiers = new Set();
for (const f of files) {
  const code = await readFile(join(dist, f), "utf8");
  for (const m of code.matchAll(/(?:^|\n)\s*import\s+(?:[^'"]*?\s+from\s+)?["']([^"'./][^"']*)["']|\bimport\(\s*["']([^"'./][^"']*)["']\s*\)/g)) {
    const spec = m[1] ?? m[2];
    if (!builtins.has(spec) && !spec.startsWith("node:")) specifiers.add(spec);
  }
}
const require = createRequire(pathToFileURL(join(dist, "index.mjs")));
const missing = [];
for (const spec of [...specifiers].sort()) {
  try { import.meta.resolve(spec, pathToFileURL(join(dist, "index.mjs")).href); }
  catch { try { require.resolve(spec); } catch { missing.push(spec); } }
}
if (missing.length) {
  console.error(`The built server imports packages that will not be found on start-up:\n  ${missing.join("\n  ")}\nAdd them to artifacts/api-server/package.json dependencies.`);
  process.exit(1);
}
console.log(`Built server imports resolve (${specifiers.size} external packages).`);
