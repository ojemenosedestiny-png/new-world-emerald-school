// Cross-platform replacement for `KEY=value command` / `export KEY=value && command`,
// which only work in POSIX shells.
// Usage: node with-env.mjs KEY=value [KEY=value...] "command && other command"
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const env = { ...process.env };
while (args.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])) {
  const assignment = args.shift();
  const index = assignment.indexOf("=");
  env[assignment.slice(0, index)] = assignment.slice(index + 1);
}
if (args.length === 0) {
  console.error("with-env: missing command");
  process.exit(1);
}

const result = spawnSync(args.join(" "), { env, shell: true, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
