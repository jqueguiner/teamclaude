#!/usr/bin/env node
// Fake `claude` binary used by the test suite.
//
// Naming choice: this script lives at `test/fixtures/fake-claude.js` and is
// invoked via `test/fixtures/claude` (a no-extension shim with a shebang that
// `import()`s this file). The shim gives `spawnSync('claude', ...)` a literal
// `claude` filename to resolve via PATH, while the `.js` suffix here keeps
// editors and ESLint configured normally.
//
// Behaviour:
//   --help                    -> prints `FAKE_CLAUDE_HELP_OUTPUT_v1` + newline
//                                to stdout, exits 0.
//   --exit-code N [more...]   -> exits with code Number(N). Remaining args are
//                                still echoed as `ARG:` lines so tests can
//                                combine flags.
//   <anything else>           -> prints each argv as `ARG:<arg>\n` to stdout,
//                                exits 0.
//
// Always echoes ANTHROPIC_BASE_URL (if set) on stderr as `ENV:ANTHROPIC_BASE_URL=<value>`
// so passthrough tests can confirm runCommand still injects the env var.
//
// Output is intentionally deterministic (no timestamps, no randomness) so
// byte-equality assertions are stable.

const argv = process.argv.slice(2);

// Always emit env probe on stderr (helps PASS env-injection tests).
if (process.env.ANTHROPIC_BASE_URL) {
  process.stderr.write(`ENV:ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL}\n`);
}

if (argv[0] === '--help') {
  process.stdout.write('FAKE_CLAUDE_HELP_OUTPUT_v1\n');
  process.exit(0);
}

if (argv[0] === '--exit-code') {
  const code = Number(argv[1]);
  // Echo any args AFTER the `--exit-code N` pair so tests can combine.
  for (const a of argv.slice(2)) {
    process.stdout.write(`ARG:${a}\n`);
  }
  process.exit(Number.isFinite(code) ? code : 1);
}

for (const a of argv) {
  process.stdout.write(`ARG:${a}\n`);
}
process.exit(0);
