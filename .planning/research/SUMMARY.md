# Project Research Summary

**Project:** teamclaude
**Domain:** CLI proxy / multi-account credential manager for Claude Code
**Researched:** 2026-05-10
**Confidence:** HIGH

## Executive Summary

teamclaude is a zero-dependency Node.js CLI proxy that wraps the `claude` binary, injecting `ANTHROPIC_BASE_URL` to route requests through a local HTTP proxy that manages OAuth token rotation across multiple Claude accounts. The new work adds two capabilities that were missing: discoverability (`teamclaude run --help` should surface Claude's flag list) and conflict safety (flags that bypass the proxy's `ANTHROPIC_BASE_URL` injection should be caught before they silently break quota rotation). Both problems have clean, low-cost solutions using only Node.js built-ins already present in the codebase.

The recommended approach is additive-only: extend `runCommand()` in `src/index.js` with a pre-flight conflict scan and a `--help` early-exit, both using `spawnSync` patterns already in use. The entire feature set can be delivered without new files, new dependencies, or changes to `server.js` or `account-manager.js`. Shell completion forwarding is a natural Phase 2 that piggybacks on the same `spawnSync` delegation pattern.

The key risk is the temptation to hardcode Claude's flag list — either in `--help` output or in the conflict-detection registry. The flag list rots with every Claude release and creates user-visible bugs. The conflict registry (the short list of flags that break proxy routing) is the one acceptable hardcoded list, because it's derived from teamclaude's own environment manipulation, not Claude's full flag surface. Everything else must delegate to the binary at runtime.

## Key Findings

### Recommended Stack

The project is intentionally zero-dependency and must stay that way. Every required capability — subprocess spawning, arg scanning, stdout/stderr passthrough, shell completion forwarding — is available via Node.js built-ins already used in the codebase. No new packages are needed for this milestone or the next. The Node.js `node:test` built-in runner (available since Node 18, which is the minimum) is sufficient for the unit tests that conflict-detection logic requires.

**Core technologies:**
- `node:child_process.spawnSync`: `--help` delegation and `run` passthrough — already the project's subprocess primitive; extend in-place
- `node:process` (`process.argv`, `process.env`): arg scanning and env-var conflict detection — 3-line scan with existing `argValue()` helper
- `node:test`: unit testing for conflict-detection correctness — keeps zero-dependency constraint; no Jest/Mocha needed
- ESLint (flat config): already wired up; no additions needed

### Expected Features

**Must have (table stakes):**
- `teamclaude run --help` delegates to `claude --help` — the first thing every user types; missing it is an immediate trust failure
- Conflict detection for `--api-url` / `--base-url` with stderr warning — silent proxy bypass is the most dangerous failure mode
- Backward-compatible passthrough — warnings must not change exit codes; existing scripts must not break

**Should have (competitive):**
- Shell completion forwarding (`teamclaude run <TAB>`) — removes the biggest friction point for power users switching from `claude` to `teamclaude run`
- Expanded conflict registry driven by real usage — add only what bug reports reveal, not speculation

**Defer (v2+):**
- Machine-readable flag metadata from `claude --help` for richer TUI display — infrastructure-heavy, low user demand
- Per-account flag compatibility checking — quota rotation already handles this implicitly

### Architecture Approach

The entire feature set fits within `runCommand()` in `src/index.js` — no new files, no new modules. The two extension points are: (1) a pre-flight conflict scan before `spawnSync`, and (2) an early-exit `--help` delegation when the first arg is `--help` or `-h`. Shell completion lives outside `src/` in a `completions/` directory. The hook-based TUI decoupling pattern already in use ensures server.js remains unaware of any new observable events.

**Major components (unchanged):**
1. `src/index.js` — CLI dispatch; extends `runCommand()` for conflict scan + help delegation
2. `src/server.js` — HTTP proxy; untouched by this work
3. `src/account-manager.js` — quota state machine; untouched by this work
4. `src/config.js` — atomic config persistence; untouched by this work
5. `src/tui.js` — TTY overlay via hooks; untouched by this work

### Critical Pitfalls

1. **Hardcoding the Claude flag list** — delegate `--help` entirely to `spawnSync('claude', ['--help'], { stdio: 'inherit' })`; prepend a short teamclaude-specific header; never maintain a static copy
2. **Silent `ANTHROPIC_BASE_URL` conflict** — scan `claudeArgs` before spawning; warn loudly to stderr; also check ambient `process.env` for pre-set `ANTHROPIC_BASE_URL`; always pass proxy URL last so it wins
3. **Arg parsing corrupting Claude positional args** — the conflict scan must respect `--` boundaries; anything after `--` is forwarded verbatim, never inspected
4. **Stale shell completion** — delegate completion queries to `claude`'s own mechanism at invocation time, never at install time; verify `claude` actually exposes a completion interface before shipping
5. **Confusing mixed help output** — use a two-section format: short teamclaude header (conflict flags, proxy behavior) + separator + verbatim `claude --help`; never let users wonder what's teamclaude vs. claude behavior

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Help Delegation + Arg Safety
**Rationale:** `--help` delegation is the highest-value, lowest-cost change and unblocks everything else. Arg-boundary safety must land in the same phase because the conflict scan introduced in Phase 2 will be unsafe without it.
**Delivers:** `teamclaude run --help` shows a teamclaude header + verbatim `claude --help`; arg passthrough is boundary-aware
**Addresses:** table-stakes discoverability; backward compatibility guarantee
**Avoids:** Pitfall 1 (hardcoded flag list), Pitfall 3 (arg parsing corruption), Pitfall 5 (confusing mixed output)

### Phase 2: Conflict Detection
**Rationale:** Depends on Phase 1's boundary-aware scan infrastructure. Conflict detection is the primary safety feature and must land before any documentation tells users `teamclaude run` is a full replacement for `claude`.
**Delivers:** stderr warning (with clear flag name) when `--api-url`, `--base-url`, or any `ANTHROPIC_BASE_URL`-override flag is detected; ambient env-var conflict detection
**Uses:** `process.argv` scan + `argValue()` helper; hardcoded conflict registry (the acceptable exception to "no static lists")
**Implements:** Flag Pre-flight Scan pattern from ARCHITECTURE.md
**Avoids:** Pitfall 2 (silent proxy bypass), security mistake of forwarding credential-leak flags

### Phase 3: Shell Completion Forwarding
**Rationale:** Depends on Phase 1's `--help` delegation being stable (same `spawnSync` delegation pattern). Medium complexity; add only after Phase 1+2 are validated in production.
**Delivers:** `teamclaude run <TAB>` forwards completion queries to `claude`'s native completion mechanism; dynamic at invocation time, not install time
**Avoids:** Pitfall 4 (stale static completion script), performance trap of synchronous `claude --help` on every tab-press

### Phase Ordering Rationale

- Phase 1 before Phase 2: conflict scan code must be boundary-aware before it can safely scan args; shipping detection without boundary-safety would corrupt `--system-prompt` values
- Phase 2 before Phase 3: completion forwarding is a differentiator; conflict detection is a safety feature; safety before polish
- All phases within `runCommand()` only: server.js and account-manager.js are stable, production-carrying components; keeping new work isolated to `index.js` eliminates regression risk

### Research Flags

Phases with standard patterns (skip research-phase):
- **Phase 1:** Well-understood CLI delegation pattern (`gh`-style subcommand help); all primitives already in codebase
- **Phase 2:** Simple array scan; conflict registry is small and explicit; no unknown unknowns

Phases likely needing verification before implementation:
- **Phase 3:** Claude's shell completion interface is undocumented — verify `claude` exposes a completion mechanism before designing the forwarding approach; may need a fallback path

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified from codebase source (`src/index.js`, `package.json`), `node --version` (v25.8.1), explicit PROJECT.md constraint "Node.js built-ins only" |
| Features | HIGH | Requirements fully specified in PROJECT.md; this is decomposition of known scope, not ecosystem discovery |
| Architecture | HIGH | Based on direct codebase analysis of all 5 `src/` files; no inferences required |
| Pitfalls | HIGH | Derived from direct inspection of `runCommand()` and `argValue()` plus well-understood CLI proxy patterns |

**Overall confidence:** HIGH

### Gaps to Address

- **Claude's completion interface:** Whether `claude` exposes `--completion-shell` or equivalent is unverified; must check at Phase 3 planning time before committing to a forwarding design
- **Conflict registry completeness:** The initial list (`--api-url`, `--base-url`, `--api-key`) is bootstrap-level; real-usage bug reports will expand it; do not treat it as exhaustive at launch

## Sources

### Primary (HIGH confidence)
- `src/index.js`, `src/server.js`, `src/account-manager.js`, `src/oauth.js`, `src/config.js` — direct codebase analysis
- `package.json`, `eslint.config.js` — stack constraints confirmed
- `.planning/PROJECT.md` — explicit constraints ("Node.js built-ins only", warn-not-error on conflicts, no static flag lists)
- `node --version` v25.8.1, `claude --version` 2.1.138 — runtime environment confirmed

### Secondary (MEDIUM confidence)
- `gh` CLI help delegation pattern — established prior art for wrapper CLI `--help` passthrough; pattern well-known but not formally cited
- Node.js 18 LTS release notes — `fetch` global, `node:test` availability

### Tertiary (LOW confidence)
- Claude Code completion interface — assumed to exist based on `spawnSync` forwarding pattern; must be verified at Phase 3 planning time

---
*Research completed: 2026-05-10*
*Ready for roadmap: yes*
