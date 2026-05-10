---
phase: 01-help-passthrough
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/index.js
  - test/run-help.test.js
  - test/run-passthrough.test.js
  - test/run-errors.test.js
  - test/fixtures/fake-claude.js
  - test/fixtures/fake-claude-fail.js
  - package.json
autonomous: true
requirements:
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

must_haves:
  truths:
    - "Running `teamclaude run --help` prints exactly what `claude --help` prints to stdout (byte-identical), with no header or framing added by teamclaude"
    - "`teamclaude run -h` behaves identically to `teamclaude run --help` (same stdout, same exit code)"
    - "`teamclaude run --help` exits with the same exit code as the underlying `claude --help` subprocess"
    - "When the `claude` binary is not on PATH, `teamclaude run --help` and `teamclaude run <args>` both exit non-zero and print an actionable message to stderr naming `claude` and how to install it"
    - "When the `claude` binary itself fails (non-ENOENT), `teamclaude run --help` exits non-zero and prints an actionable stderr message"
    - "`teamclaude run -- <args>` strips a single leading `--` separator and forwards the remainder to `claude` unchanged"
    - "Stdout from `teamclaude run` is byte-identical to running `claude` directly with the same args"
    - "Exit code of `teamclaude run` always equals the exit code returned by the spawned `claude` process"
    - "Existing `teamclaude run <args>` invocations that worked before this phase produce the same stdout and exit code after this phase"
  artifacts:
    - path: src/index.js
      provides: "runCommand() with --help/-h delegation and improved ENOENT/spawn-error messages"
      contains: "claudeArgs[0] === '--help'"
    - path: test/run-help.test.js
      provides: "node:test coverage for HELP-01..HELP-04"
      min_lines: 40
    - path: test/run-passthrough.test.js
      provides: "node:test coverage for PASS-01..PASS-03 and COMPAT-01..COMPAT-03"
      min_lines: 40
    - path: test/run-errors.test.js
      provides: "node:test coverage for ERR-01 and HELP-04"
      min_lines: 25
    - path: test/fixtures/fake-claude.js
      provides: "Configurable stub `claude` binary used by tests via PATH override"
      min_lines: 15
    - path: package.json
      provides: "`test` npm script that runs `node --test test/`"
      contains: "\"test\""
  key_links:
    - from: src/index.js (runCommand)
      to: spawnSync('claude', ['--help'], { stdio: 'inherit' })
      via: "early-exit branch when claudeArgs[0] is '--help' or '-h'"
      pattern: "spawnSync\\('claude', \\['--help'\\]"
    - from: src/index.js (runCommand)
      to: process.exit(result.status ?? 1)
      via: "exit-code propagation after spawnSync returns"
      pattern: "process\\.exit\\(result\\.status"
    - from: test/* fixtures
      to: src/index.js runCommand path
      via: "PATH=test/fixtures:$PATH spawn so `claude` resolves to fake-claude.js"
      pattern: "PATH.*fixtures"
---

<objective>
Make `teamclaude run --help` (and `-h`) execute `claude --help` and pipe its output verbatim to stdout, exiting with the matching exit code. Lock down passthrough byte-exactness and exit-code propagation for all `teamclaude run` invocations. Improve error messages when `claude` is missing or fails so users get actionable next steps. Add a `node:test` suite covering every Phase 1 requirement.

Purpose: HELP-01..04 + PASS-01..03 + COMPAT-01..03 + ERR-01 are the trust foundation for the proxy. Without verbatim help and matching exit codes, users can't discover Claude flags or script around `teamclaude run`. Without an actionable "claude not found" message, install failures look like teamclaude bugs.

Output: A modified `runCommand()` in `src/index.js`, three node:test files, a tiny stub-binary fixture, and a `test` npm script.
</objective>

<resolved_tensions>
**HELP-01 vs ROADMAP Phase 1 success criterion #1 (resolved):** REQUIREMENTS.md HELP-01 is authoritative — `teamclaude run --help` MUST emit `claude --help` output **verbatim**, with **no teamclaude header**, no preamble, no separator. ROADMAP success criterion #1 ("teamclaude proxy header followed by verbatim claude --help output") is superseded by HELP-01 for this phase. A teamclaude-specific header/preamble is deferred to Phase 2 (where conflict-detection messaging belongs on stderr) or to a future docs task. Rationale: HELP-01's "no modification" wording is unambiguous; any prepended bytes break byte-equivalence with `claude --help` and create a regression vector for tooling that pipes/diffs help output.

**Action items spawned by this resolution:**
- ROADMAP.md success criterion #1 should be edited (in a follow-up housekeeping commit, not this phase) to read: "`teamclaude run --help` and `teamclaude run -h` both produce byte-identical output to `claude --help`, exiting with the same code."
- Pitfall 5 (PITFALLS.md "two-section format") is explicitly NOT followed in Phase 1 — stdout stays clean. Any teamclaude-specific guidance for users belongs on stderr or in `teamclaude help` (the top-level `help` command, which is separate from `run --help`).
</resolved_tensions>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
@.planning/research/SUMMARY.md
@.planning/research/ARCHITECTURE.md
@.planning/research/PITFALLS.md

<interfaces>
<!-- Current runCommand at src/index.js:335-364 (the extension point). -->
<!-- Executor should diff against this exact code; do not rewrite the file. -->

```javascript
// src/index.js:335-364 (current)
async function runCommand() {
  const config = await loadOrCreateConfig();

  // Everything after 'run' (skip -- separator if present)
  const claudeArgs = args.slice(1);
  if (claudeArgs[0] === '--') claudeArgs.shift();

  // Only set ANTHROPIC_BASE_URL — Claude Code keeps its own OAuth token
  // which the proxy accepts from localhost. Not setting ANTHROPIC_API_KEY
  // lets Claude Code stay in subscription mode (full model access).
  // Use spawnSync so the Node process blocks entirely — behaves like execvp.
  const result = spawnSync('claude', claudeArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: `http://localhost:${config.proxy.port}`,
    },
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      console.error('Claude Code not found in PATH. Install it first.');
    } else {
      console.error(`Failed to start claude: ${result.error.message}`);
    }
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}
```

Imports already in scope at top of file:
```javascript
import { spawnSync } from 'node:child_process';
import { loadOrCreateConfig, /* ... */ } from './config.js';
```

Top-level argv plumbing (src/index.js:11-12):
```javascript
const args = process.argv.slice(2);
const command = args[0];
```

Constraints from PROJECT.md and package.json:
- Zero npm dependencies (Node built-ins only). `node:test` is the test runner.
- Node >= 18 (engines field). `node --test` is available.
- Module type: ESM (`"type": "module"` in package.json). All test files use ESM imports.
- `src/` is the only published directory (`files: ["src/"]`). Test files MUST live outside `src/` so they aren't shipped — use top-level `test/`.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add test infrastructure (npm script + fake-claude fixtures)</name>
  <files>package.json, test/fixtures/fake-claude.js, test/fixtures/fake-claude-fail.js</files>
  <behavior>
    - `npm test` exits 0 when no tests have been written yet (initial scaffold) — verified with a placeholder test that asserts `true`.
    - `test/fixtures/fake-claude.js` is an executable Node script (shebang, chmod +x) that:
      - Reads its own argv.
      - If first arg is `--help`: prints a known fixture string `FAKE_CLAUDE_HELP_OUTPUT_v1` to stdout and exits 0.
      - If first arg is `--exit-code` and second is a number N: exits N.
      - Otherwise: prints argv (one arg per line, prefix `ARG:`) to stdout and exits 0.
      - Echoes any teamclaude-managed env var of interest (`ANTHROPIC_BASE_URL`) to stderr prefixed `ENV:` so passthrough tests can confirm the env is set.
    - `test/fixtures/fake-claude-fail.js` is an executable Node script that exits with code 7 and prints `simulated claude crash` to stderr (for HELP-04 spawn-failure scenarios distinct from ENOENT).
  </behavior>
  <action>
    1. Edit `package.json`: add `"test": "node --test test/"` to the `scripts` object. Do not add any dependency.
    2. Create `test/fixtures/fake-claude.js` per the behavior block above. Use `#!/usr/bin/env node` shebang. Make it executable: `chmod +x test/fixtures/fake-claude.js`. The file MUST be named exactly `claude` when invoked — use a symlink or copy at test time, OR put the script at `test/fixtures/claude` (no `.js` suffix) so PATH resolution finds it as `claude`. Recommended: put the actual logic in `test/fixtures/fake-claude.js`, then create `test/fixtures/claude` as either a symlink (`ln -s fake-claude.js claude`) or a tiny shim (`#!/usr/bin/env node\nimport('./fake-claude.js')`). Document the choice in a header comment.
    3. Create `test/fixtures/fake-claude-fail.js` per behavior. Same naming/exec considerations — provide a `claude-fail` shim if needed, or have tests rename per case via a tmpdir.
    4. Add `test/.smoke.test.js` with a single `test('npm test runs', () => { assert.ok(true); })` to confirm the test runner is wired.
  </action>
  <verify>
    <automated>npm test</automated>
  </verify>
  <done>
    - `npm test` exits 0 with at least one test executed.
    - `test/fixtures/claude --help` (executed directly) prints `FAKE_CLAUDE_HELP_OUTPUT_v1` and exits 0.
    - `test/fixtures/claude --exit-code 42` exits with code 42.
    - `test/fixtures/claude foo bar` prints `ARG:foo\nARG:bar` to stdout.
    - `test/fixtures/claude-fail` exits 7.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement --help / -h delegation in runCommand()</name>
  <files>src/index.js, test/run-help.test.js</files>
  <behavior>
    - Test H1 (HELP-01): With PATH pointing at `test/fixtures/`, spawning `node src/index.js run --help` produces stdout exactly equal to `FAKE_CLAUDE_HELP_OUTPUT_v1\n` (byte-for-byte). No teamclaude header, no preamble, no extra newline beyond what `claude` itself emits.
    - Test H2 (HELP-02): Same setup with the fake-claude rigged to exit 0 → teamclaude exits 0. Re-run with fixture flagged to exit 3 → teamclaude exits 3. Exit codes match exactly.
    - Test H3 (HELP-03): `teamclaude run -h` produces identical stdout and exit code to `teamclaude run --help` (diff -q the captured outputs; both exit codes assertEqual).
    - Test H4 (PASS-02 interaction with help): `teamclaude run -- --help` strips the leading `--` and triggers help delegation (stdout equals fake-claude help fixture). This proves `--` handling runs BEFORE the help check.
    - Test H5: When the user passes flags AFTER `--help` (e.g. `teamclaude run --help --verbose`), only `claude --help` is spawned (the trailing flags are dropped). This matches the documented behavior: help delegation calls `spawnSync('claude', ['--help'])` with no other args. Document this as a deliberate choice and assert it.
  </behavior>
  <action>
    1. Modify `runCommand()` in `src/index.js` to add a help-delegation early branch after the `--` strip:
       ```javascript
       async function runCommand() {
         const config = await loadOrCreateConfig();
         const claudeArgs = args.slice(1);
         if (claudeArgs[0] === '--') claudeArgs.shift();

         // HELP-01..03: delegate --help / -h to `claude --help` verbatim,
         // no teamclaude header (HELP-01 requires "no modification").
         if (claudeArgs[0] === '--help' || claudeArgs[0] === '-h') {
           const helpResult = spawnSync('claude', ['--help'], { stdio: 'inherit' });
           if (helpResult.error) {
             // HELP-04 handled in Task 4. Forward intent here; the
             // detailed message is added there. For now, fall through to
             // the existing error-handling block by jumping to it.
             handleSpawnError(helpResult.error);
           }
           process.exit(helpResult.status ?? 1);
         }

         // ... existing spawnSync(claude, claudeArgs, ...) below unchanged
       }
       ```
       Where `handleSpawnError(err)` is a small helper added in Task 4. For Task 2, inline a placeholder that prints the existing message and exits 1 — Task 4 will replace it. (This sequencing keeps each task self-contained; Task 2's tests only exercise the success path, Task 4's tests exercise failure.)
    2. The existing `spawnSync('claude', claudeArgs, ...)` and post-spawn handling stay untouched in this task.
    3. Create `test/run-help.test.js` with tests H1..H5. Each test:
       - Uses `child_process.spawnSync('node', [path.join(repoRoot, 'src/index.js'), 'run', ...])` with `env: { ...process.env, PATH: fixturesDir + ':' + process.env.PATH }` so `claude` resolves to the fake.
       - Captures stdout/stderr as buffers; compares stdout to expected fixture string with `assert.strictEqual`.
       - Captures exit code via `result.status`.
    4. Tests use `node:test` and `node:assert/strict`. Use `import { test } from 'node:test'; import assert from 'node:assert/strict';` ESM style.
    5. Tests must NOT depend on a real `claude` binary being installed. PATH is overridden to point only at fixtures (or fixturesDir is prepended).
  </action>
  <verify>
    <automated>node --test test/run-help.test.js</automated>
  </verify>
  <done>
    - All five tests (H1..H5) pass.
    - `node src/index.js run --help` with a PATH containing fake-claude prints exactly the fake help fixture and nothing else on stdout.
    - `-h` and `--help` produce byte-identical stdout (asserted via Buffer.equals or strictEqual).
    - HELP-01, HELP-02, HELP-03 are satisfied (verified by tests covering each); HELP-04 is stubbed and finalized in Task 4.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Lock down passthrough + exit-code propagation tests (PASS-01..03, COMPAT-01..03)</name>
  <files>test/run-passthrough.test.js</files>
  <behavior>
    - Test P1 (PASS-01 byte-exact stdout): `node src/index.js run hello world` with fake-claude on PATH produces stdout exactly `ARG:hello\nARG:world\n` — no teamclaude prefix, no extra bytes. Compared with `Buffer.equals` against expected.
    - Test P2 (PASS-02 `--` strip): `node src/index.js run -- --model opus` produces stdout `ARG:--model\nARG:opus\n` (the leading `--` is removed; the `--model` flag is forwarded as the first arg).
    - Test P3 (PASS-02 only ONE leading `--` is stripped): `node src/index.js run -- -- foo` produces `ARG:--\nARG:foo\n` (only the FIRST `--` is treated as a separator; subsequent `--` is forwarded). Document & assert this matches the existing implementation.
    - Test P4 (PASS-03 exit-code): `node src/index.js run --exit-code 0` exits 0; `--exit-code 5` exits 5; `--exit-code 137` exits 137. Three subtests.
    - Test P5 (COMPAT-01 + COMPAT-02): A "control" invocation that worked pre-phase (`run hello`) still produces the same stdout AND exits 0 — re-run the equivalent of an existing scenario and confirm no regression.
    - Test P6 (COMPAT-03 + LOG separation prep): Anything teamclaude prints (none in success path) does not appear on stdout. Capture stderr and assert that on a successful passthrough, stdout contains ONLY the fake-claude `ARG:` lines and stderr contains at most the fake-claude `ENV:` line — never any teamclaude string. Use a regex assertion: `assert.doesNotMatch(stdoutString, /teamclaude/i)`.
    - Test P7 (env injection still works): The fake-claude echoes `ENV:ANTHROPIC_BASE_URL=http://localhost:<port>` on stderr. Assert this line appears, confirming `runCommand()` still sets the env var. This protects against an executor accidentally removing the env injection while refactoring.
  </behavior>
  <action>
    1. Create `test/run-passthrough.test.js` with tests P1..P7. Same harness pattern as Task 2 (spawn `node src/index.js`, PATH override, capture buffers).
    2. Tests assert on raw `Buffer` where byte-equality matters (PASS-01). Use `Buffer.from(expected)` and `assert.deepStrictEqual(result.stdout, expectedBuf)` — strings via stringification can hide trailing-byte regressions.
    3. For exit-code tests (P4), pass `'--exit-code'` and `'5'` as separate args; the fake-claude reads `argv[2]` and `argv[3]` and exits accordingly.
    4. P5 is a guard test — pick a representative pre-phase invocation (e.g. `run hello`) and assert stdout matches what fake-claude would produce. This locks behavior so future refactors can't break compat silently.
    5. P7: parse stderr for the `ENV:ANTHROPIC_BASE_URL=` line; assert the URL prefix is `http://localhost:`. Don't assert the exact port (it's config-dependent).
  </action>
  <verify>
    <automated>node --test test/run-passthrough.test.js</automated>
  </verify>
  <done>
    - All seven tests (P1..P7) pass.
    - PASS-01, PASS-02, PASS-03 verified.
    - COMPAT-01, COMPAT-02, COMPAT-03 verified.
    - Test P7 confirms `ANTHROPIC_BASE_URL` is still injected — guard against regression in subsequent phases.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Actionable error messages for missing/failing claude binary (ERR-01, HELP-04)</name>
  <files>src/index.js, test/run-errors.test.js</files>
  <behavior>
    - Test E1 (ERR-01 plain run): With PATH set to a directory that does NOT contain `claude`, `node src/index.js run hello` exits non-zero AND stderr contains:
      - the literal string `claude` (the binary name),
      - the word `PATH`,
      - an actionable install hint that mentions either `npm install -g @anthropic-ai/claude-code` OR a URL pointing at install docs (e.g. https://docs.anthropic.com/claude/docs/claude-code or whatever the current canonical install reference is — the executor picks one and documents it inline).
      - Stderr does NOT contain a raw stack trace (no `at ` lines, no `Error: spawn ENOENT` raw).
    - Test E2 (ERR-01 + HELP-04 missing-claude during --help): Same PATH-without-claude environment, but invoking `node src/index.js run --help`. Same actionable stderr. Exit code non-zero.
    - Test E3 (HELP-04 claude exists but help fails): Use a fixture where the binary exists at `test/fixtures/claude` but exits non-zero on `--help` (re-purpose `--exit-code 9` so `claude --help` returns 9). teamclaude must propagate the same non-zero exit code AND not print the ENOENT/install message (because the binary was found — just failed). Stderr from teamclaude should be empty (the user already saw whatever fake-claude wrote); the failure mode here is exit-code propagation, which HELP-02 covers — HELP-04 specifically targets the spawn-fail / not-found path.
    - Test E4 (other spawn errors): Simulate a non-ENOENT spawn error by making the file at `test/fixtures/claude` non-executable (`chmod 644`). On platforms where this produces EACCES, teamclaude prints a stderr message that contains the actual error code (EACCES) AND a hint ("check file permissions" or similar). Exit non-zero. Skip on platforms where chmod permissions don't gate execution (e.g. Windows — node:test supports `t.skip()`).
  </behavior>
  <action>
    1. In `src/index.js`, factor the spawn-error handling into a helper at module scope (or inside `runCommand`):
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
       ```
       Replace the existing inline `if (result.error)` block in the main spawn path with a call to `handleSpawnError(result.error)`. Replace the placeholder from Task 2 in the help-delegation branch with the same call. Both call sites use the helper — single source of truth.
    2. The exact install command/URL is the executor's call but MUST be actionable (a string the user can copy-paste). Add a brief inline comment explaining where it came from.
    3. Create `test/run-errors.test.js` with tests E1..E4. Use `os.mkdtempSync` to create an empty PATH dir for E1/E2 (no `claude` present). For E3, use the existing fixtures dir but spawn with `--exit-code 9 --help`-equivalent (extend fake-claude to handle `--help` + a chained `--exit-code` flag, OR add a separate fixture script). For E4, create a temp file `claude` without `+x` and PATH at the temp dir; wrap in `t.skip()` if the platform doesn't enforce exec bit.
    4. Use `assert.match(stderr, /claude/)` and `assert.match(stderr, /PATH/i)` for E1/E2. Use `assert.doesNotMatch(stderr, /^\s+at /m)` to forbid stack traces.
    5. For E3, assert `result.status === 9` (HELP-02 propagation under failure) and `result.stderr.toString()` does NOT contain the install hint (that's an ENOENT-only message).
  </action>
  <verify>
    <automated>node --test test/run-errors.test.js</automated>
  </verify>
  <done>
    - All four tests pass (E4 may be skipped on incompatible platforms).
    - ERR-01 verified: missing claude → actionable stderr + non-zero exit.
    - HELP-04 verified for both not-found and runtime-failure modes.
    - `handleSpawnError` is the single source of truth for spawn-error messaging — both the help-delegation branch and the passthrough branch use it.
    - No regression in Task 2/3 tests (run full suite to confirm).
  </done>
</task>

<task type="auto">
  <name>Task 5: Full-suite green run and requirement-traceability self-check</name>
  <files>test/run-help.test.js, test/run-passthrough.test.js, test/run-errors.test.js</files>
  <action>
    1. Run `npm test` (which runs `node --test test/`) and confirm all tests pass with no warnings.
    2. Add a header comment to each test file mapping `test name -> requirement ID`. Example:
       ```
       // HELP-01: Test H1 (byte-identical stdout)
       // HELP-02: Test H2 (exit code matches)
       // HELP-03: Test H3 (-h identical to --help)
       // PASS-02: Test H4 (-- before --help)
       ```
       This is a documentation-only edit; no behavior changes. Each requirement listed in this PLAN's frontmatter MUST appear in at least one comment.
    3. Quick grep self-check (run as part of verify): `grep -RE "HELP-0[1-4]|PASS-0[1-3]|COMPAT-0[1-3]|ERR-01" test/ | grep -v '^Binary' | wc -l` returns >= 11 (one line per requirement, allowing duplicates). If under 11, identify the missing ID and add a comment in the test that covers it.
    4. Run `node src/index.js run --help` MANUALLY against a real `claude` binary if available locally (`which claude` succeeds). Capture stdout to a file, then run `claude --help > /tmp/expected.txt` and `diff` the two. They should be byte-identical. This is a real-world smoke check — if `claude` isn't installed in the dev env, skip this step but document it in the task summary.
  </action>
  <verify>
    <automated>npm test && grep -RE "HELP-0[1-4]|PASS-0[1-3]|COMPAT-0[1-3]|ERR-01" test/ | grep -v '^Binary' | wc -l | awk '$1 >= 11 {exit 0} {exit 1}'</automated>
  </verify>
  <done>
    - All tests pass.
    - Each Phase 1 requirement ID (HELP-01..04, PASS-01..03, COMPAT-01..03, ERR-01 = 11 total) appears in at least one test-file comment for traceability.
    - Manual smoke check (real claude binary diff) executed if claude is installed, with result noted in SUMMARY.md.
  </done>
</task>

</tasks>

<test_strategy>

## Coverage Map (requirement → test)

| Req | Type | Where | How |
|-----|------|-------|-----|
| HELP-01 | Automated | test/run-help.test.js — H1 | Spawn `run --help` with fake-claude; assert stdout buffer == `FAKE_CLAUDE_HELP_OUTPUT_v1\n` (byte-equal, no header) |
| HELP-02 | Automated | test/run-help.test.js — H2 | Run with fake-claude exiting 0 then 3; assert teamclaude exit codes match |
| HELP-03 | Automated | test/run-help.test.js — H3 | Run `-h` and `--help`; assert stdout buffers identical and exit codes equal |
| HELP-04 | Automated | test/run-errors.test.js — E2, E3 | (a) missing claude during --help → actionable stderr + non-zero; (b) claude --help itself fails → propagated non-zero, no install hint |
| PASS-01 | Automated | test/run-passthrough.test.js — P1, P6 | Byte-exact stdout match against fixture; stdout contains zero teamclaude bytes |
| PASS-02 | Automated | test/run-passthrough.test.js — P2, P3; H4 | Single `--` stripped; double `--` only strips first; works in conjunction with --help |
| PASS-03 | Automated | test/run-passthrough.test.js — P4 | Three exit codes (0, 5, 137) all propagated |
| COMPAT-01 | Automated | test/run-passthrough.test.js — P5 | Pre-phase scenario still produces expected stdout + exit 0 |
| COMPAT-02 | Automated | test/run-passthrough.test.js — P5 (exit-0 branch) | No conflict triggered → exit 0 |
| COMPAT-03 | Automated | test/run-passthrough.test.js — P6 | Stdout contains zero teamclaude-emitted bytes |
| ERR-01 | Automated | test/run-errors.test.js — E1 | PATH without claude → stderr names `claude`, mentions PATH, includes install hint, no stack trace, exit non-zero |

**No manual-only tests required for Phase 1.** Manual smoke-check in Task 5 (real `claude` binary diff) is recommended-not-required and documented in the SUMMARY.

## Test Harness Conventions

- Test runner: `node --test` (built-in, Node ≥18)
- Assertion: `node:assert/strict` ESM
- Binary resolution: every test sets `env.PATH = fixturesDir + ':' + process.env.PATH` (or for ERR-01, an empty tmp dir) so `spawnSync('claude', ...)` resolves to the fixture, not a real install
- Spawn target: `node src/index.js run <args...>` (run via `child_process.spawnSync`, NOT by importing the module — the module calls `process.exit()` and uses top-level `await`, both of which break in-process testing)
- Buffer comparisons: `assert.deepStrictEqual(result.stdout, Buffer.from(expected))` for byte-exactness; `assert.strictEqual(result.stdout.toString(), expected)` for normal string assertions

## Why a fake-claude fixture (not the real binary)

- Tests must be reproducible across dev machines and CI without depending on a `claude` install.
- Fake binary is deterministic — exits/echoes are exact, so byte-equality assertions are stable.
- Real-binary smoke check happens once in Task 5 manually, not in the automated suite.

</test_strategy>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Shell → teamclaude argv | User-supplied args; teamclaude inspects only `args[0]` for `--`/`--help`/`-h` and forwards the rest unmodified |
| teamclaude → claude (spawnSync) | teamclaude controls the env (`ANTHROPIC_BASE_URL` injection); arg array is forwarded verbatim except for the leading `--` strip |
| User PATH → spawnSync('claude') | `claude` is resolved by the OS via PATH; teamclaude has no control over which binary actually runs |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-01 | Spoofing | spawnSync('claude') resolves to a malicious binary on PATH | accept | Out of scope for Phase 1; user controls PATH. The pre-existing tool already has this property. Phase 2's conflict detection does not change this. Documented as known acceptance — no new attack surface introduced. |
| T-01-02 | Tampering | A flag in `claudeArgs` that overrides ANTHROPIC_BASE_URL silently bypasses the proxy | accept (deferred) | Conflict detection (CONF-01..05) is explicitly Phase 2 scope per REQUIREMENTS.md and ROADMAP.md. Phase 1 explicitly does NOT add conflict detection. Documented in PROJECT.md §Constraints. |
| T-01-03 | Information Disclosure | Stack trace leaks internal paths or library versions on spawn failure | mitigate | `handleSpawnError` (Task 4) prints only the `err.code` and `err.message`, never the stack. Test E1 asserts no `at ` lines appear in stderr. |
| T-01-04 | Information Disclosure | A teamclaude diagnostic message accidentally printed to stdout corrupts script consumers | mitigate | All teamclaude-emitted text goes through `console.error` (stderr). Test P6 asserts stdout contains zero teamclaude bytes on the success path. |
| T-01-05 | Denial of Service | A user passing thousands of args causes spawnSync to hang or OOM | accept | OS-level argv length limit (ARG_MAX) bounds this; no special handling needed. Same behavior as direct `claude` invocation — passthrough fidelity. |
| T-01-06 | Elevation of Privilege | Help delegation accidentally runs `claude` with elevated env (e.g. setuid binary picked up via PATH) | accept | Same surface as direct `claude` invocation; user controls PATH. No new privilege boundary crossed by teamclaude. |

</threat_model>

<verification>

## Phase-level verification

After all tasks complete, the following must be true (run as a final manual check before /gsd-execute-phase --verify):

1. `npm test` exits 0 with no warnings.
2. `node src/index.js run --help` (with claude installed) produces stdout byte-identical to `claude --help`. Diff: `diff <(node src/index.js run --help 2>/dev/null) <(claude --help 2>/dev/null)` returns no output.
3. `node src/index.js run -h` (with claude installed) produces stdout byte-identical to `node src/index.js run --help`.
4. `PATH=/empty/dir node src/index.js run hello` exits non-zero and stderr starts with `teamclaude: ` and contains `npm install -g @anthropic-ai/claude-code` (or whichever install hint was chosen).
5. `node src/index.js run -- --version` (or any innocuous claude flag) still produces correct passthrough output and exits with claude's exit code.
6. `git diff src/index.js` shows changes only in `runCommand()` and possibly a new `handleSpawnError` helper — no edits to `server.js`, `account-manager.js`, `oauth.js`, or `config.js`.
7. `wc -l src/index.js` increased by no more than ~30 lines (sanity check on scope creep).

</verification>

<success_criteria>

This phase is done when:

- [ ] HELP-01: `teamclaude run --help` produces byte-identical stdout to `claude --help` (verified by Task 2 H1 + manual diff in Task 5)
- [ ] HELP-02: Exit codes match for both success (0) and failure (≥1) cases (Task 2 H2)
- [ ] HELP-03: `-h` is fully equivalent to `--help` (Task 2 H3)
- [ ] HELP-04: Failed `claude --help` produces actionable stderr + non-zero exit (Task 4 E2, E3)
- [ ] PASS-01: Byte-exact stdout passthrough (Task 3 P1, P6)
- [ ] PASS-02: `--` separator stripping works correctly (Task 3 P2, P3; Task 2 H4)
- [ ] PASS-03: Exit-code propagation across multiple values (Task 3 P4)
- [ ] COMPAT-01..03: Pre-phase invocations unchanged; stdout uncorrupted (Task 3 P5, P6)
- [ ] ERR-01: Missing claude binary → actionable stderr + non-zero (Task 4 E1)
- [ ] All tests in test/ pass via `npm test`
- [ ] No edits outside `src/index.js`, `package.json`, and `test/`
- [ ] Each requirement ID appears in test-file comments (Task 5 traceability)
- [ ] Threat model items T-01-03 and T-01-04 verified by automated tests
- [ ] runCommand() touches +30 LOC or fewer in src/index.js

</success_criteria>

<risks_and_open_questions>

## Risks

1. **Real `claude --help` may emit non-deterministic output** (e.g. timestamps, randomized tip-of-the-day). If so, the HELP-01 byte-equality assertion against a real binary in Task 5's smoke check could fail spuriously. Mitigation: tests use the fake-claude fixture with deterministic output; the real-binary diff is informational, not a gate. If the manual diff reveals non-determinism, document it in SUMMARY.md and confirm HELP-01 is still satisfied for the deterministic portion.

2. **Fixture binary naming on macOS/Linux**: `spawnSync('claude', ...)` requires PATH to contain a file literally named `claude` (not `claude.js`). The plan uses a symlink or no-extension shim — executor must verify `which claude` returns the fixture during tests. Mitigation: Task 1 explicitly documents two approaches (symlink vs shim); executor picks based on what works in the dev env.

3. **`spawnSync` on Windows** has different PATH/exec-bit semantics. The plan assumes a Unix-like dev environment (matches macOS dev box per env metadata). Test E4 already accounts for this with `t.skip()` for permission-based assertions. If CI runs on Windows, Task 1's fixture must be a `.cmd` shim — note this in SUMMARY.md but treat as out of scope for Phase 1.

4. **Help-delegation drops trailing args** (e.g. `run --help --verbose` runs only `claude --help`). This is documented as deliberate (Task 2 H5) but could surprise users who expect `--verbose` to still apply. Mitigation: matches REQUIREMENTS.md HELP-01 wording ("executes `claude --help`") which implies just those two args. Phase 2 can revisit if user feedback demands.

5. **Install hint in stderr is a moving target.** The recommended `npm install -g @anthropic-ai/claude-code` may change. Mitigation: keep the message generic enough that it stays useful even if the exact command shifts; the test (E1) asserts the *category* of content (mentions `claude`, `PATH`, an install command) not the exact string.

## Open Questions

1. **Should the help-delegation branch run BEFORE or AFTER `loadOrCreateConfig()`?** The current plan keeps `loadOrCreateConfig` first (matches existing code structure). This means `teamclaude run --help` triggers config-file creation as a side effect, which is mildly surprising. Two options:
   - **Keep as-is** (safe, no surprise behavior change for an existing code path).
   - **Move help-check above** `loadOrCreateConfig()` so `--help` is a pure delegation with zero side effects.
   - Phase 1 chooses **keep as-is** to minimize behavioral surface change. Mark as a candidate Phase 2 cleanup.

2. **Should `teamclaude run` (no args at all) trigger help, error, or just spawn `claude` with no args?** Current code passes empty `claudeArgs` to `claude`, which spawns interactive Claude. Plan preserves this behavior. If user feedback says they expect help, revisit in Phase 2.

3. **Fake-claude fixture file naming**: should it be `test/fixtures/claude` (no extension, exec bit) or a real-script + symlink pair? Both work; executor decides during Task 1. Document the choice in fixture file header for future maintainers.

</risks_and_open_questions>

<output>
After completion, create `.planning/phases/01-help-passthrough/01-01-SUMMARY.md` documenting:
- Final shape of `runCommand()` (paste the new function)
- Test count and which requirement each test covers
- Whether the manual real-binary diff smoke check (Task 5) was run, and its result
- Resolution of open question #1 (config-load ordering) if any deviation occurred
- Any fixture-naming decisions made during Task 1
</output>
