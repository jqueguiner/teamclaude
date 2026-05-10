---
phase: 01-help-passthrough
plan: 01
subsystem: cli
tags: [help, passthrough, exit-codes, error-messages, node-test, spawn]

requires:
  - phase: 00-bootstrap
    provides: existing runCommand() with --` separator handling and ANTHROPIC_BASE_URL injection
provides:
  - "`teamclaude run --help` and `-h` delegate to `claude --help` byte-identically (HELP-01..03)"
  - "Verbatim stdout passthrough + exit-code propagation locked down by tests (PASS-01..03)"
  - "Backward compatibility for pre-phase invocations preserved & guarded by tests (COMPAT-01..03)"
  - "Actionable, stack-trace-free error messages when `claude` is missing or unrunnable (ERR-01, HELP-04)"
  - "node:test scaffolding with deterministic fake-claude fixture binary (zero new deps)"
affects: [phase-02-conflict-detection, phase-02-logging]

tech-stack:
  added: ["node:test (built-in test runner)"]
  patterns:
    - "Module-scope `handleSpawnError(err)` helper as single source of truth for ENOENT/EACCES/other spawn-error messaging"
    - "Test harness pattern: spawn `node src/index.js run ...` with PATH override pointing at test/fixtures/ — never depend on real `claude` install"
    - "Buffer-equality assertions for byte-exact stdout (avoids string-side trailing-byte regressions)"

key-files:
  created:
    - test/run-help.test.js
    - test/run-passthrough.test.js
    - test/run-errors.test.js
    - test/smoke.test.js
    - test/fixtures/fake-claude.js
    - test/fixtures/fake-claude-fail.js
    - test/fixtures/claude
    - test/fixtures/claude-fail
  modified:
    - src/index.js
    - package.json

key-decisions:
  - "Help-delegation branch sits AFTER `--` strip and AFTER loadOrCreateConfig() — preserves existing config side-effect, deferred to Phase 2 cleanup (Open Q #1)"
  - "Trailing flags after --help are deliberately dropped — `claude --help` spawned with exactly two args. Documented in code comment + asserted by test H5"
  - "handleSpawnError filled in fully during Task 2 GREEN rather than as Task 4 placeholder — cleaner single source of truth, smaller code-churn footprint"
  - "Fixture naming: shebang shim `test/fixtures/claude` -> `import('./fake-claude.js')` — gives spawnSync a literal `claude` filename via PATH while keeping the .js suffix on the implementation file for editor/tooling sanity"
  - "test runner script changed from `node --test test/` (planned) to `node --test test/*.test.js` because Node 25 treats a directory arg as a module path; glob also keeps fixtures out of test discovery"

patterns-established:
  - "Pattern: every test spawns the CLI via `process.execPath` (absolute node) so PATH replacement only affects `claude` resolution, not node itself"
  - "Pattern: empty-PATH error tests use `os.mkdtempSync` for isolation; cleanup via `fs.rmSync({recursive, force})` in finally"
  - "Pattern: T-01-03 stack-trace mitigation asserted in EVERY error-path test (`assert.doesNotMatch(stderr, /^\\s+at /m)`)"

requirements-completed:
  - HELP-01
  - HELP-02
  - HELP-03
  - HELP-04
  - PASS-01
  - PASS-02
  - PASS-03
  - COMPAT-01
  - COMPAT-02
  - COMPAT-03
  - ERR-01

duration: ~25min
completed: 2026-05-10
---

# Phase 1 Plan 1: Help Passthrough & Error Surface Summary

**`teamclaude run --help`/`-h` now executes `claude --help` verbatim with matching exit code; passthrough byte-exactness, exit-code propagation, and actionable spawn-failure messages are locked down by 19 node:test cases.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-10 (T1 scaffold)
- **Completed:** 2026-05-10
- **Tasks:** 5/5
- **Files created:** 8 (4 test files + 4 fixtures)
- **Files modified:** 2 (`src/index.js`, `package.json`)

## Accomplishments

- Verified end-to-end: `diff <(node src/index.js run --help) <(claude --help)` is empty (byte-identical) against the real `claude` binary on the dev machine.
- 19 automated tests, 100% pass, zero new npm dependencies — `node --test` only.
- `src/index.js` net change: +29 LOC (within plan's ~30 LOC budget).
- All 11 Phase 1 requirement IDs explicitly traced in test-file headers; grep self-check returns 34 ID occurrences (≥11 minimum).

## Task Commits

| # | Task | SHA | Type |
|---|------|-----|------|
| 1 | Test infrastructure (npm script + fake-claude fixtures) | `88f8706` | feat |
| 2 RED | `run --help`/`-h` delegation tests | `c627ddf` | test |
| 2 GREEN | runCommand `--help`/`-h` delegation + `handleSpawnError` | `60ca8a1` | feat |
| 3 | Passthrough fidelity tests (PASS-01..03, COMPAT-01..03) | `182ae27` | test |
| 4 | Actionable error-message tests (ERR-01, HELP-04) | `585fa43` | test |
| 5 | Verification only — no source changes (traceability comments were preemptively included in tasks 2–4 test files) | _(no commit)_ | — |

Plan metadata commit will follow this SUMMARY.

## Final Shape of `runCommand()`

```javascript
function handleSpawnError(err) {
  if (err.code === 'ENOENT') {
    console.error('teamclaude: `claude` binary not found in PATH.');
    console.error('Install Claude Code: npm install -g @anthropic-ai/claude-code');
    console.error('Then verify with: which claude && claude --version');
  } else if (err.code === 'EACCES') {
    console.error(`teamclaude: cannot execute \`claude\`: ${err.message}`);
    console.error('Check the file permissions on the resolved binary (chmod +x).');
  } else {
    console.error(`teamclaude: failed to start \`claude\`: ${err.message} (${err.code ?? 'unknown'})`);
    console.error('Check that Claude Code is installed and accessible.');
  }
  process.exit(1);
}

async function runCommand() {
  const config = await loadOrCreateConfig();

  const claudeArgs = args.slice(1);
  if (claudeArgs[0] === '--') claudeArgs.shift();

  // HELP-01..03: delegate `--help` / `-h` to `claude --help` verbatim.
  if (claudeArgs[0] === '--help' || claudeArgs[0] === '-h') {
    const helpResult = spawnSync('claude', ['--help'], { stdio: 'inherit' });
    if (helpResult.error) handleSpawnError(helpResult.error);
    process.exit(helpResult.status ?? 1);
  }

  const result = spawnSync('claude', claudeArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: `http://localhost:${config.proxy.port}`,
    },
  });

  if (result.error) handleSpawnError(result.error);
  process.exit(result.status ?? 1);
}
```

## Test Inventory & Requirement Mapping

| File | Tests | Requirements Covered |
|------|-------|----------------------|
| `test/smoke.test.js` | 1 | (scaffold only) |
| `test/run-help.test.js` | 5 (H1–H5) | HELP-01, HELP-02, HELP-03, PASS-02 |
| `test/run-passthrough.test.js` | 9 (P1–P7, with P4 split into 3 exit-code subtests) | PASS-01, PASS-02, PASS-03, COMPAT-01, COMPAT-02, COMPAT-03 |
| `test/run-errors.test.js` | 4 (E1–E4) | ERR-01, HELP-04, T-01-03 stack-trace mitigation |

**Total: 19 tests, 19 pass, 0 fail, 0 skip.** (E4 has a Windows-only skip path but ran on macOS.)

## Manual Smoke Check (Task 5)

Real `claude` binary was available locally (`/Users/jlqueguiner/.local/bin/claude` v2.1.138).

```
$ diff <(node src/index.js run --help 2>/dev/null) <(claude --help 2>/dev/null)
(no output — byte-identical)
$ node src/index.js run --help > /dev/null; echo $?
0
$ claude --help > /dev/null; echo $?
0
$ diff <(node src/index.js run -h) <(node src/index.js run --help)
(no output — byte-identical)
```

`HELP-01` and `HELP-03` confirmed against the real binary, not just the fake fixture.

## Decisions Made

1. **Open Question #1 (config-load ordering): kept as-is.** Help delegation runs AFTER `loadOrCreateConfig()`, matching plan recommendation. This preserves the existing side effect (config-file creation on first `run` invocation) — minimizes behavioural surface change for users who already rely on it. Marked as a Phase 2 cleanup candidate; not blocking.

2. **handleSpawnError finalized in Task 2.** Plan suggested a placeholder during Task 2 with full implementation in Task 4. I implemented the helper completely in Task 2 because (a) the helper is small (~20 LOC), (b) the plan explicitly required "single source of truth", and (c) Task 4's tests immediately needed real ENOENT/EACCES messages to assert against. Net effect: one fewer source-edit churn between Task 2 and Task 4, no behavioural delta. Documented as Rule 3 (auto-fix blocking issue) — the placeholder approach would have required a Task 4 source edit for the same outcome.

3. **Fixture naming: shim approach.** Used `test/fixtures/claude` (no extension, shebang `#!/usr/bin/env node`, body `import('./fake-claude.js')`) rather than a symlink. Reason: keeps the implementation file with its `.js` suffix for editor/lint tooling, avoids OS-specific symlink semantics. The shim is exactly 4 lines.

4. **`npm test` script: glob instead of dir.** Plan specified `node --test test/`, but Node 25 treats a directory argument as a module path (no auto-discovery). Switched to `node --test test/*.test.js`, which (a) works on Node 25, (b) keeps fixture `.js` files out of test discovery, (c) still globs to pick up future test files. Documented as Rule 3 (auto-fix blocking issue).

5. **PASS-02 P3 semantics confirmed.** `run -- -- foo` strips only the first `--`, leaving `--` and `foo` to be forwarded. Asserted by test P3. This matches the existing `claudeArgs[0] === '--'` shift logic — no code change needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Node 25 `node --test test/` failure**
- **Found during:** Task 1 verification.
- **Issue:** On Node v25.8.1 the harness errors with `Cannot find module '.../test'` when `test/` is passed as a positional arg — Node treats it as a module path, not a directory glob.
- **Fix:** Changed npm script to `node --test test/*.test.js`. Bonus: glob excludes `test/fixtures/*.js` from discovery, which Node was otherwise picking up.
- **Files modified:** `package.json`.
- **Verification:** `npm test` → 19/19 pass.
- **Commit:** `88f8706` (Task 1).

**2. [Rule 3 - Blocking issue] PATH replacement breaks shebang `#!/usr/bin/env node`**
- **Found during:** Task 4 E3 test.
- **Issue:** When tests replace PATH with just a tmp dir to hide a real `claude` install, the fake-claude shim's shebang lookup (`/usr/bin/env node`) fails because `node` is no longer on PATH.
- **Fix (a):** Use `process.execPath` (absolute node binary) when spawning teamclaude itself, so the test child can launch even with empty PATH. (b) For E3 specifically, prepend `path.dirname(process.execPath)` to the test PATH so the symlinked claude shim's shebang resolves.
- **Files modified:** `test/run-errors.test.js`.
- **Verification:** E1–E4 all pass.
- **Commit:** `585fa43` (Task 4).

**3. [No rule — preemptive] Traceability comments included during Tasks 2–4 instead of Task 5**
- **Issue:** Task 5 was scheduled to add `test name -> requirement ID` header comments to each test file. I included these comments inline when creating each file in Tasks 2–4.
- **Effect:** Task 5 had no source-change work — only verification (npm test green + grep self-check). No separate Task 5 commit.
- **Verification:** `grep -RE "HELP-0[1-4]|PASS-0[1-3]|COMPAT-0[1-3]|ERR-01" test/ | wc -l` → 34 (≥11 required).

## Phase-level Verification Checklist

- [x] `npm test` exits 0, 19/19 tests pass.
- [x] `diff <(node src/index.js run --help) <(claude --help)` empty (real binary byte-identical).
- [x] `node src/index.js run -h` byte-identical to `node src/index.js run --help`.
- [x] `env -i PATH=/usr/bin:/bin node src/index.js run hello` exits 1 with stderr starting `teamclaude:` and including `npm install -g @anthropic-ai/claude-code`.
- [x] `node src/index.js run -- --version` (innocuous flag) preserved (asserted by P2-pattern tests; not run against real claude to avoid network/account side effects in this session).
- [x] `git diff` on `src/index.js` confined to runCommand + new handleSpawnError; no edits to server.js / account-manager.js / oauth.js / config.js.
- [x] `wc -l src/index.js`: 797 lines (was 768) → +29 LOC (under +30 budget).
- [x] All threat register `mitigate` items verified by automated tests:
  - T-01-03 (stack-trace leak): asserted in E1–E4 via `assert.doesNotMatch(stderr, /^\s+at /m)`.
  - T-01-04 (teamclaude bytes on stdout): asserted in P6 via `assert.doesNotMatch(stdout, /teamclaude/i)`.

## Self-Check: PASSED

All claimed files exist; all claimed commits exist in `git log`. 19/19 tests pass. Manual smoke against real `claude` binary returns byte-identical output.
