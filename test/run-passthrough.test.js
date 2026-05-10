// Phase 1 — passthrough fidelity & exit-code propagation tests.
//
// Requirement traceability:
//   PASS-01: Test P1 (byte-exact stdout), Test P6 (no teamclaude bytes on stdout)
//   PASS-02: Test P2 (single `--` stripped), Test P3 (only ONE `--` stripped)
//   PASS-03: Test P4 (exit-code propagation across 0, 5, 137)
//   COMPAT-01: Test P5 (pre-phase scenario unchanged)
//   COMPAT-02: Test P5 (no conflict triggered → exit 0)
//   COMPAT-03: Test P6 (stdout free of teamclaude-emitted bytes)
//
// (P7 guards env-var injection — protects against accidental removal of
// ANTHROPIC_BASE_URL injection during refactors.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const indexPath = path.join(repoRoot, 'src/index.js');
const fixturesDir = path.join(repoRoot, 'test/fixtures');

function runTeamclaude(extraArgs) {
  return spawnSync('node', [indexPath, 'run', ...extraArgs], {
    encoding: 'buffer',
    env: {
      ...process.env,
      PATH: fixturesDir + path.delimiter + process.env.PATH,
    },
  });
}

test('P1 (PASS-01): stdout is byte-exact passthrough — no teamclaude prefix or extras', () => {
  const result = runTeamclaude(['hello', 'world']);
  assert.strictEqual(result.status, 0, `stderr=${result.stderr}`);
  // Buffer comparison guards against trailing-byte regressions that string
  // assertions hide (e.g. an accidental BOM or extra newline).
  assert.deepStrictEqual(result.stdout, Buffer.from('ARG:hello\nARG:world\n'));
});

test('P2 (PASS-02): single leading `--` is stripped before forwarding', () => {
  const result = runTeamclaude(['--', '--model', 'opus']);
  assert.strictEqual(result.status, 0);
  // The `--` is removed; --model becomes argv[0] forwarded to claude.
  assert.deepStrictEqual(result.stdout, Buffer.from('ARG:--model\nARG:opus\n'));
});

test('P3 (PASS-02): only the FIRST `--` is treated as a separator; subsequent `--` is forwarded', () => {
  const result = runTeamclaude(['--', '--', 'foo']);
  assert.strictEqual(result.status, 0);
  assert.deepStrictEqual(result.stdout, Buffer.from('ARG:--\nARG:foo\n'));
});

test('P4 (PASS-03): exit code 0 propagates', () => {
  const result = runTeamclaude(['--exit-code', '0']);
  assert.strictEqual(result.status, 0);
});

test('P4 (PASS-03): exit code 5 propagates', () => {
  const result = runTeamclaude(['--exit-code', '5']);
  assert.strictEqual(result.status, 5);
});

test('P4 (PASS-03): exit code 137 propagates', () => {
  const result = runTeamclaude(['--exit-code', '137']);
  assert.strictEqual(result.status, 137);
});

test('P5 (COMPAT-01 + COMPAT-02): pre-phase invocation `run hello` unchanged, exit 0', () => {
  // Guard test: locks behavior so future refactors can't silently break the
  // pre-phase contract. `run hello` should produce exactly the fake-claude
  // ARG: line for `hello` and exit 0 — no teamclaude conflict-detection
  // currently exists, so no banner/warning either.
  const result = runTeamclaude(['hello']);
  assert.strictEqual(result.status, 0);
  assert.deepStrictEqual(result.stdout, Buffer.from('ARG:hello\n'));
});

test('P6 (PASS-01 + COMPAT-03): stdout contains zero teamclaude-emitted bytes on success path', () => {
  const result = runTeamclaude(['hello']);
  // No occurrence of "teamclaude" anywhere in stdout (case-insensitive).
  // Anything teamclaude prints MUST go to stderr (T-01-04 mitigation).
  assert.doesNotMatch(result.stdout.toString(), /teamclaude/i);
});

test('P7 (env injection): ANTHROPIC_BASE_URL is set in the spawned claude environment', () => {
  // fake-claude echoes the env var on stderr as `ENV:ANTHROPIC_BASE_URL=<value>`.
  // Asserting this guards against an executor accidentally removing the env
  // injection while refactoring runCommand. We don't pin the exact port
  // (config-dependent), only the URL prefix.
  const result = runTeamclaude(['hello']);
  const stderr = result.stderr.toString();
  assert.match(stderr, /^ENV:ANTHROPIC_BASE_URL=http:\/\/localhost:\d+/m,
    `expected ENV: line in stderr; got: ${stderr}`);
});
