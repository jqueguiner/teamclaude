# Pitfalls Research

**Domain:** CLI proxy / multi-account credential manager for a third-party binary (Claude Code)
**Researched:** 2026-05-10
**Confidence:** HIGH — derived from direct codebase inspection and well-understood CLI/proxy domain patterns

---

## Critical Pitfalls

### Pitfall 1: Hardcoding the Claude Flag List

**What goes wrong:**
A static copy of `claude --help` flags is embedded in `teamclaude run --help`. Claude Code ships updates
frequently; the static list drifts within weeks. Users see flags that don't exist yet (or flags that
were renamed/removed), breaking trust in the tool.

**Why it happens:**
It's the path of least resistance — parse `claude --help` once, paste the output, ship it. The problem
only becomes visible after Claude updates.

**How to avoid:**
Delegate `--help` entirely to `claude --help` via `spawnSync('claude', ['--help'], { stdio: 'inherit' })`.
Add a small teamclaude-specific header explaining the proxy overhead, then let the binary do the rest.
The flag list stays current automatically without any maintenance.

**Warning signs:**
- `--help` output contains a version string that doesn't match `claude --version`
- A flag listed in `--help` silently fails when passed
- New Claude Code releases cause bug reports about missing flags

**Phase to address:** Phase 1 (help delegation) — this is the core deliverable and must be correct from day one.

---

### Pitfall 2: Silent Conflict on `ANTHROPIC_BASE_URL`-Override Flags

**What goes wrong:**
The user passes a flag like `--api-url https://my-proxy.example.com` or sets `ANTHROPIC_BASE_URL` in
their shell before running `teamclaude run`. The flag or env var overrides the proxy's `ANTHROPIC_BASE_URL`
injection. Requests go directly to upstream (bypassing quota rotation) or to the wrong endpoint. No error
is shown; quota rotation silently stops working.

**Why it happens:**
`spawnSync` inherits the parent environment, so any `ANTHROPIC_BASE_URL` already set in the shell
survives into the child process. Similarly, CLI flags parsed by the `claude` binary can override the env
var that teamclaude injected.

**How to avoid:**
- Scan `claudeArgs` before spawning for flags that touch base URL or API key configuration
  (`--api-url`, `--base-url`, or any future equivalent). Emit a clear error: "this flag conflicts with
  teamclaude's proxy setup."
- **Always** override `ANTHROPIC_BASE_URL` in the env passed to `spawnSync` (already done), but also
  check if the user's ambient env has it set to something different and warn.
- Never blindly merge `...process.env` for conflict-sensitive vars — set teamclaude's values last so
  they win, and document which vars are controlled.

**Warning signs:**
- `teamclaude status` shows no traffic but Claude appears to be responding
- Rate limits hit immediately despite multiple accounts
- User reports quota rotation stopped working after adding a flag

**Phase to address:** Phase 2 (conflict detection) — must warn before any flag is forwarded.

---

### Pitfall 3: Arg Parsing Interferes with Claude Positional Args

**What goes wrong:**
teamclaude's own argument parser (the `argValue()` helper) scans `args` for `--flag value` pairs.
If a Claude flag value happens to match a teamclaude flag name (e.g., `--system-prompt "--log-to"`) the
value is consumed as a teamclaude flag, corrupting the args passed to `claude`.

**Why it happens:**
Both command layers share the same argv array. teamclaude currently only parses its own top-level flags,
but once `run --help` documentation exposes all flags, users will experiment and edge cases will emerge
(especially with `--system-prompt` which accepts arbitrary strings).

**How to avoid:**
Stop teamclaude from parsing _any_ arg after `run`. The only pre-spawn inspection allowed is:
a) scanning for known conflict flags (Pitfall 2) and
b) stripping `--` separator (already done).
Use a safe scan that respects `--` boundaries: anything after `--` is never inspected, only forwarded.

**Warning signs:**
- User reports `--system-prompt` value being truncated
- teamclaude flags like `--log-to` appear to fire when passed as Claude arg values
- Tests with quoted multi-word prompts fail

**Phase to address:** Phase 1 (arg forwarding) and Phase 2 (conflict scan must be boundary-aware).

---

### Pitfall 4: Shell Completion Breaks or Lags Behind Claude Versions

**What goes wrong:**
A static completion script is generated once and installed. After Claude updates its flags, tab completion
suggests removed flags or omits new ones. Users learn to ignore completion, defeating its purpose.

**Why it happens:**
Shell completion is generated at install time and cached by the shell (`.bashrc`, `.zshrc` source a static
file). Any dynamic generation must be wired into the shell's completion invocation, not a one-time setup step.

**How to avoid:**
Forward the completion query to `claude`'s own completion mechanism at invocation time, not at install time.
For `bash`/`zsh`, the completion function should call `claude --<completion-flag>` dynamically. Do not
cache or pre-generate — delegate live.

Verify that `claude` actually exposes a completion interface before shipping (some CLI tools don't). If it
doesn't, fall back to generating completions by parsing `claude --help` at completion time (not install time).

**Warning signs:**
- Completion suggests `--api-key` after Claude removed it
- New flags from a Claude release don't appear in completion for weeks

**Phase to address:** Phase 3 (shell completion) — must be dynamic-delegation, not static generation.

---

### Pitfall 5: `--help` Forwarding Mixes teamclaude and Claude Output Confusingly

**What goes wrong:**
`teamclaude run --help` dumps Claude's raw `--help` output with no context. Users can't distinguish
teamclaude-specific behavior (proxy, account rotation, conflict flags) from standard Claude behavior. They
assume all flags work identically and are surprised when `--api-url` triggers a teamclaude warning.

**Why it happens:**
Pure delegation is clean but loses the opportunity to surface teamclaude's additions. The tendency is to
either say nothing (confusing) or duplicate the entire flag list (fragile).

**How to avoid:**
Use a two-section format:
1. A short teamclaude-specific header (conflict flags, proxy behavior) — maintained in source, never duplicates Claude's list.
2. Then `claude --help` output verbatim with a separator line like `---- claude --help ----`.

This gives users the full picture without maintaining a flag list.

**Warning signs:**
- Users pass `--api-url` expecting it to reconfigure the proxy
- Support questions about flags that are actually standard Claude behavior

**Phase to address:** Phase 1 (help delegation) — design the output format before implementation.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Static flag list in `--help` | Easy to write now | Rots after every Claude release; requires manual maintenance | Never — delegation is trivially achievable |
| Scan all of `claudeArgs` without respecting `--` boundary | Simpler conflict-detection code | Corrupts args containing teamclaude flag names as values | Never — boundary check is one `indexOf('--')` call |
| Hardcode `ANTHROPIC_BASE_URL` conflict flags | Quick to ship | Misses new flags; gives false security | Acceptable as bootstrap, but add a comment and a link to `claude --help` for review |
| One-time completion generation at install | Easy to wire up | Stale after any Claude update | Never for completions — delegate live |
| Warn on conflicts but still forward the conflicting flag | Less disruptive to user scripts | Makes conflict detection meaningless; proxy silently misconfigures | Never — warn AND block; give the user an escape hatch (`--force`) only if there's a documented reason |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `spawnSync('claude', ...)` | Forgetting that `spawnSync` with `stdio: 'inherit'` blocks the Node process — correct — but also that the parent's signal handlers won't run during the block | Accept this; document that `teamclaude run` is meant to replace the shell's Claude invocation entirely |
| `ANTHROPIC_BASE_URL` injection | Setting it in `process.env` before spawning — this mutates the parent process env, which can leak across multiple commands in the same process | Always pass env as `{ ...process.env, ANTHROPIC_BASE_URL: ... }` in the `spawnSync` options object, never mutate `process.env` directly |
| Claude's shell completion | Assuming `claude` exposes `--completion` or `_complete` subcommand | Verify at implementation time; the mechanism varies by shell and CLI framework |
| `claude --help` output format | Parsing the help text to extract flags (fragile) | Just forward it verbatim; only parse if you must generate completions and no dynamic mechanism exists |
| OAuth token in proxy env | The `run` command intentionally does NOT set `ANTHROPIC_API_KEY` — Claude Code uses its own OAuth token | Do not add `ANTHROPIC_API_KEY` to the spawnSync env; it would switch Claude into API-key mode, breaking Max/Pro subscription behavior |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Calling `claude --help` synchronously on every tab-press for completion | Noticeable lag (200–500ms) on each `<TAB>` | Cache the output in the shell completion function with a short TTL (e.g., 60s) or check version to invalidate | Immediately perceptible; tab completion feels broken |
| Spawning `claude --version` on every `teamclaude run` to detect conflicts | 100–200ms overhead before every invocation | Do version checks lazily, only when a potentially conflicting flag is detected | Breaks user perception of passthrough transparency |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging `--system-prompt` content to `--log-to` files without stripping secrets | Sensitive prompts (containing API keys, personal data) written to disk in plaintext | Log is already opt-in via `--log-to`; document that logs contain full prompt content and should be treated as sensitive |
| Allowing `--api-url` passthrough to arbitrary endpoints | teamclaude's OAuth tokens forwarded to an attacker-controlled server | Detect and block `--api-url` (and any equivalent) before spawning; this is a credential leak vector |
| Conflict detection that only warns but still forwards | User assumes the warning is informational; credentials routed to wrong endpoint | Block on conflict — don't forward the conflicting flag. Provide `--unsafe-skip-conflict-check` as an explicit escape if truly needed |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| `teamclaude run --help` shows only Claude's help with no teamclaude context | User doesn't learn about proxy conflicts; passes `--api-url` and breaks rotation silently | Prepend a short teamclaude section (conflict flags, proxy behavior) before delegating to Claude's help |
| Conflict warning buried in verbose output | User misses the warning; scripts break silently later | Print conflict warnings to stderr in bold/red-prefixed format: `[teamclaude ERROR] --api-url conflicts with proxy setup`; exit non-zero |
| Shell completion installs a static file | After Claude updates, completion becomes wrong; users lose trust | Use dynamic delegation that queries the binary at completion time |
| `teamclaude run --` (bare `--`) does nothing useful | User expects `--` to explicitly signal "everything after goes to claude" | Already handled (strips `--` and forwards rest); verify edge case of `teamclaude run --` with no args after it |

---

## "Looks Done But Isn't" Checklist

- [ ] **Help delegation:** Output includes both the teamclaude-specific header AND Claude's verbatim help — verify the separator and both sections appear
- [ ] **Conflict detection:** Verified against actual `claude --help` output that all conflict-relevant flags are detected — not just the ones known at time of writing
- [ ] **Arg boundary:** `--system-prompt "value containing --log-to"` passes to Claude unmodified — test with adversarial values
- [ ] **Shell completion:** Tab-completion works after a `claude` update without reinstalling teamclaude — test by mocking a version bump
- [ ] **Backward compatibility:** Existing `teamclaude run --print -p "hello"` invocations still work unchanged after the feature — run the existing integration test suite

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Hardcoded flag list shipped in a release | MEDIUM | Release a patch that switches to delegation; users update teamclaude |
| Conflicting flag forwarded silently (leaked credential) | HIGH | Revoke affected OAuth token immediately; add conflict detection in hotfix; audit proxy logs for unexpected upstream targets |
| Completion script became stale | LOW | Delete the static completion file and implement dynamic delegation; re-source the shell |
| Arg parsing corrupted system prompt | LOW | Switch to boundary-aware scan; no data loss since `claude` would have errored anyway |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Hardcoded flag list | Phase 1: Help delegation | Run `claude --help` and diff against `teamclaude run --help`; they should be identical after the header |
| Silent `ANTHROPIC_BASE_URL` conflict | Phase 2: Conflict detection | Pass `--api-url https://evil.example.com`; verify teamclaude exits non-zero with a clear error |
| Arg parsing corrupting Claude args | Phase 1: Arg forwarding | Test `teamclaude run --system-prompt "--log-to"` and verify Claude receives the full string |
| Stale shell completion | Phase 3: Shell completion | Mock a Claude version bump and verify `<TAB>` still returns current flags without reinstalling |
| Confusing mixed help output | Phase 1: Help delegation | User-test the output format; verify the teamclaude section is clearly delimited from Claude's section |

---

## Sources

- Direct inspection of `/Users/jlqueguiner/dev/teamclaude/src/index.js` — `runCommand()` and `argValue()` implementation
- Direct inspection of `/Users/jlqueguiner/dev/teamclaude/src/server.js` — proxy env handling
- `.planning/PROJECT.md` — constraint: "cannot hardcode flag lists that go stale — prefer delegating `--help` to the binary"
- Known CLI proxy pattern: environment variable injection via spawnSync options (not process.env mutation)
- Known shell completion pattern: dynamic delegation vs. static generation trade-offs

---
*Pitfalls research for: CLI proxy / multi-account credential manager (teamclaude)*
*Researched: 2026-05-10*
