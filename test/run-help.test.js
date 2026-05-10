// Phase 1 — `teamclaude run --help` delegation tests.
//
// Requirement traceability:
//   HELP-01: Test H1 (byte-identical stdout)
//   HELP-02: Test H2 (exit code matches subprocess)
//   HELP-03: Test H3 (-h identical to --help)
//   PASS-02: Test H4 (`--` strip runs before help check)
//   HELP-01: Test H5 (trailing flags after --help are dropped — deliberate)
//
// Harness convention: every test spawns `node src/index.js run ...` with
// PATH overridden to point at `test/fixtures/` so `spawnSync('claude', ...)`
// inside runCommand resolves to our fake. Tests never depend on a real
// `claude` install.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const indexPath = path.join(repoRoot, 'src/index.js');
const fixturesDir = path.join(repoRoot, 'test/fixtures');

/** Spawn teamclaude with the fixture PATH override. */
function runTeamclaude(extraArgs, { fixturesDirOverride } = {}) {
  const fixDir = fixturesDirOverride ?? fixturesDir;
  return spawnSync('node', [indexPath, 'run', ...extraArgs], {
    encoding: 'buffer',
    env: {
      ...process.env,
      PATH: fixDir + path.delimiter + process.env.PATH,
    },
  });
}

test('H1 (HELP-01): `run --help` stdout is byte-identical to `claude --help`', () => {
  const result = runTeamclaude(['--help']);
  assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}; stderr=${result.stderr}`);
  // Byte-exact assertion: no teamclaude header, no preamble, no trailing extras.
  assert.deepStrictEqual(result.stdout, Buffer.from('FAKE_CLAUDE_HELP_OUTPUT_v1\n'));
});

test('H2 (HELP-02): exit code matches `claude --help` subprocess exit code', () => {
  // Success case (exit 0)
  const ok = runTeamclaude(['--help']);
  assert.strictEqual(ok.status, 0);
  // Failure case: HELP-02 is fully exercised in run-errors.test.js (E3) where
  // we use claude-fail as the binary to force a non-zero exit on --help.
  // Here we just confirm the success path propagates the 0 verbatim.
});

test('H3 (HELP-03): `-h` produces byte-identical stdout AND exit code to `--help`', () => {
  const helpResult = runTeamclaude(['--help']);
  const dashHResult = runTeamclaude(['-h']);
  assert.strictEqual(helpResult.status, dashHResult.status);
  assert.deepStrictEqual(helpResult.stdout, dashHResult.stdout);
});

test('H4 (PASS-02): `run -- --help` strips `--` THEN delegates help', () => {
  // Proves `--` handling runs before the help check — the leading `--`
  // separator is stripped, leaving `--help` as args[0], which then triggers
  // help delegation.
  const result = runTeamclaude(['--', '--help']);
  assert.strictEqual(result.status, 0);
  assert.deepStrictEqual(result.stdout, Buffer.from('FAKE_CLAUDE_HELP_OUTPUT_v1\n'));
});

test('H5 (HELP-01): trailing flags after --help are dropped (claude --help spawned with no extra args)', () => {
  // Documented design: help delegation calls spawnSync('claude', ['--help'])
  // with NO other args. If a user types `run --help --verbose`, the --verbose
  // is dropped. We verify by checking stdout is the deterministic help fixture
  // alone (not `ARG:--verbose` lines that fake-claude would emit if --verbose
  // were forwarded).
  const result = runTeamclaude(['--help', '--verbose', 'extra']);
  assert.strictEqual(result.status, 0);
  assert.deepStrictEqual(result.stdout, Buffer.from('FAKE_CLAUDE_HELP_OUTPUT_v1\n'));
  // Defense-in-depth: stdout should not contain any ARG: lines.
  assert.doesNotMatch(result.stdout.toString(), /^ARG:/m);
});
