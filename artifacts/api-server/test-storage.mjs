import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Keep the runner usable in read-only workspaces; resolve externals here before
// writing bundles to the system temp directory.
const directory = await mkdtemp(join(tmpdir(), 'storage-tests-'));
try {
  const tests = ['byte-range', 'objectStorage-range', 'serve-object', 'render-deploy'];
  await build({
    entryPoints: tests.map((name) => fileURLToPath(new URL(`./src/lib/${name}.test.ts`, import.meta.url))),
    outdir: directory,
    bundle: true,
    platform: 'node',
    format: 'esm',
    outExtension: { '.js': '.mjs' },
    plugins: [{
      name: 'resolve-storage-test-externals',
      setup(build) {
        build.onResolve({ filter: /^(@google-cloud\/storage|express)$/ }, (args) => ({
          // A file:// URL is a valid ESM specifier on every OS; a bare C:\ path is not.
          path: import.meta.resolve(args.path), external: true,
        }));
      },
    }],
  });
  const result = spawnSync(process.execPath, [
    '--trace-warnings', '--test', '--test-timeout=20000',
    ...tests.map((name) => join(directory, `${name}.test.mjs`)),
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}