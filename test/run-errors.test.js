// Phase 1 — actionable error messages on missing or failing `claude` binary.
//
// Requirement traceability:
//   ERR-01:   Tests E1, E2 (missing claude → actionable stderr + non-zero exit)
//   HELP-04:  Tests E2, E3 (missing claude during --help, and claude --help
//             itself failing — exit code propagated, no install hint when
//             binary actually ran)
//   T-01-03:  All tests assert stderr does NOT contain raw stack-trace lines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const indexPath = path.join(repoRoot, 'src/index.js');
const fixturesDir = path.join(repoRoot, 'test/fixtures');

/** Spawn teamclaude with PATH replaced (not prepended) by `pathDir`. */
function runTeamclaudeWithPath(pathDir, extraArgs) {
  // Use process.execPath (absolute path to the current `node` binary) so the
  // child can be spawned even when the test PATH is empty / restricted.
  // PATH replacement then ONLY affects how `claude` is resolved inside
  // runCommand — which is exactly what we want to test.
  return spawnSync(process.execPath, [indexPath, 'run', ...extraArgs], {
    encoding: 'buffer',
    env: {
      ...process.env,
      PATH: pathDir,
    },
  });
}

/** Mint a fresh empty tmp dir and return its absolute path. */
function emptyTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'teamclaude-test-'));
}

test('E1 (ERR-01): missing claude on plain `run hello` → actionable stderr + non-zero exit', () => {
  const tmp = emptyTmpDir();
  try {
    const result = runTeamclaudeWithPath(tmp, ['hello']);
    assert.notStrictEqual(result.status, 0,
      `expected non-zero exit; got ${result.status}`);
    const stderr = result.stderr.toString();
    // ERR-01: must mention `claude` literally, mention PATH, and contain an
    // actionable install hint (npm install -g @anthropic-ai/claude-code).
    assert.match(stderr, /claude/, `stderr missing 'claude': ${stderr}`);
    assert.match(stderr, /PATH/i, `stderr missing 'PATH': ${stderr}`);
    assert.match(stderr, /npm install -g @anthropic-ai\/claude-code/,
      `stderr missing install hint: ${stderr}`);
    // T-01-03: no raw stack trace.
    assert.doesNotMatch(stderr, /^\s+at /m,
      `stderr leaked stack trace: ${stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('E2 (HELP-04): missing claude during `run --help` → same actionable stderr + non-zero exit', () => {
  const tmp = emptyTmpDir();
  try {
    const result = runTeamclaudeWithPath(tmp, ['--help']);
    assert.notStrictEqual(result.status, 0);
    const stderr = result.stderr.toString();
    assert.match(stderr, /claude/);
    assert.match(stderr, /PATH/i);
    assert.match(stderr, /npm install -g @anthropic-ai\/claude-code/);
    assert.doesNotMatch(stderr, /^\s+at /m);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('E3 (HELP-04): claude binary exists but exits non-zero on --help → exit code propagated, no install hint', () => {
  // Build a temp PATH dir whose `claude` always exits 7 (use claude-fail shim).
  const tmp = emptyTmpDir();
  try {
    const failingClaude = path.join(tmp, 'claude');
    // Symlink claude-fail (which always exits 7) to literally `claude` in tmp.
    fs.symlinkSync(path.join(fixturesDir, 'claude-fail'), failingClaude);
    // For E3 the PATH must include node's directory so the shim's
    // `#!/usr/bin/env node` shebang can resolve. PATH replacement still
    // hides any real `claude` install (the only `claude` resolvable is our
    // failing symlink in tmp).
    const nodeDir = path.dirname(process.execPath);
    const result = runTeamclaudeWithPath(`${tmp}${path.delimiter}${nodeDir}`, ['--help']);
    // HELP-02 propagation under failure: exit code matches the spawned process.
    assert.strictEqual(result.status, 7,
      `expected exit 7, got ${result.status}; stderr=${result.stderr}`);
    // Binary was found and ran — teamclaude must NOT print the install hint
    // (that's an ENOENT-only message).
    const stderr = result.stderr.toString();
    assert.doesNotMatch(stderr, /npm install -g @anthropic-ai\/claude-code/,
      `teamclaude wrongly printed install hint when binary ran: ${stderr}`);
    // The fake-claude-fail's own message ("simulated claude crash") may or
    // may not be present here depending on stdio inheritance; we don't pin
    // it. We DO assert that teamclaude added no header/preamble of its own.
    assert.doesNotMatch(stderr, /^teamclaude:/m,
      `teamclaude added stderr message when none was warranted: ${stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('E4 (HELP-04 EACCES): non-executable claude binary → actionable stderr mentions permissions', (t) => {
  // Skip on Windows where chmod doesn't gate execution the same way.
  if (process.platform === 'win32') {
    t.skip('chmod-based exec gating is POSIX-specific');
    return;
  }
  const tmp = emptyTmpDir();
  try {
    const claudeFile = path.join(tmp, 'claude');
    fs.writeFileSync(claudeFile, '#!/bin/sh\necho should-not-run\n');
    fs.chmodSync(claudeFile, 0o644); // not executable
    const result = runTeamclaudeWithPath(tmp, ['hello']);
    assert.notStrictEqual(result.status, 0);
    const stderr = result.stderr.toString();
    // Note: spawnSync may report EACCES *or* ENOENT depending on whether the
    // OS surfaces the permission denial as "no such executable". On macOS
    // the typical code is EACCES; on some Linux configurations it can be
    // ENOENT. Accept either, but in both cases stderr must be actionable
    // (not a stack trace) and mention `claude`.
    assert.match(stderr, /claude/);
    assert.doesNotMatch(stderr, /^\s+at /m);
    if (/EACCES/.test(stderr)) {
      assert.match(stderr, /permissions|chmod/i,
        `EACCES path missing permissions hint: ${stderr}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
