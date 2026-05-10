# Stack Research

**Domain:** CLI proxy / wrapper tool (Node.js, zero-dependency)
**Researched:** 2026-05-10
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js ESM | ≥18.0.0 (host: v25.8.1) | Runtime | Built-in `fetch`, `spawnSync`, `readline`, `http` — everything needed without any npm packages. ESM (`"type": "module"`) already locked in the project. |
| `node:child_process.spawnSync` | built-in | Delegate `claude` invocations and capture `--help` output | Already used for `run`; extend with `{ stdio: ['ignore', 'pipe', 'pipe'] }` capture mode to read `claude --help` text without a subprocess visible to the user. |
| `node:child_process.execSync` | built-in | Shell completion forwarding | Needed for tab-completion: exec `claude --completion-shell bash` (or equivalent) and emit the result on stdout, then exit 0 — the shell sees it as if `claude` replied. |
| `node:process` | built-in | Arg scanning, env var conflict detection | `process.argv`, `process.env` — scan before forwarding to detect `--api-url`, `ANTHROPIC_API_KEY` overrides; emit warning to stderr then continue. |
| ESLint (flat config) | current (no version pin) | Linting | Already configured in `eslint.config.js`; catches `no-undef`, `no-unused-vars` — sufficient for a zero-dependency project with no type checker. |

### Supporting Libraries

_None. The zero-dependency constraint is intentional and correct for a CLI tool distributed via `npm install -g`. Every dependency is a potential supply-chain risk and an install-time size cost for a tool that users will run thousands of times per day._

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| ESLint (flat config) | Catch common JS mistakes | Already wired up; run `npx eslint src/` before PRs. No type-checking pipeline needed — the codebase is small enough that manual review catches type errors. |
| Node.js built-in test runner (`node:test`) | Unit tests for arg-conflict detection logic | Use `node --test` (available since Node 18). No Jest, no Mocha — keeps the zero-dependency constraint clean. Add tests for the conflict-detection path specifically, since that's new behavior with a correctness requirement. |

## Installation

```bash
# No new dependencies needed.
# This feature is implemented entirely with Node.js built-ins.

# To run linting:
npx eslint src/

# To run tests (when added):
node --test src/**/*.test.js
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `spawnSync` with `stdio: 'pipe'` to capture `claude --help` | Parse a static hard-coded flag list | Never — a static list rots with every Claude Code release. Delegating to the binary guarantees freshness. |
| Scan raw `process.argv` for conflict detection | Use `commander` or `yargs` to parse args | Only if teamclaude ever needs complex sub-command parsing beyond what it already has. For flag-conflict detection, a simple `args.includes('--api-url')` scan is 3 lines and zero deps. |
| `node:test` for unit tests | Jest / Mocha / Vitest | Use Jest/Vitest only if the test suite grows large enough to need snapshot testing, parallel execution, or a watch mode. For 5-10 tests on the conflict-detection path, `node:test` is sufficient. |
| Bash/Zsh completion scripts in the npm package | Dynamic `claude --completion` forwarding | Static completion scripts are fine if Claude's completion API is unstable or unavailable. Check `claude --completion-shell bash` first; fall back to a static list only if the binary doesn't support it. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `commander` / `yargs` / `minimist` | Adds a dependency for something already handled by 5 lines of `process.argv` parsing; breaks the zero-dependency constraint | Raw `process.argv` scanning — already the pattern throughout the codebase (`argValue()` helper in `index.js`) |
| `chalk` / `kleur` / `picocolors` | Adds a dependency for color output; not needed for warning messages | `\x1b[33m...\x1b[0m` ANSI sequences directly — already used in `tui.js` where needed |
| Hardcoded flag list in `teamclaude run --help` | Rots immediately as Claude Code releases; requires manual maintenance per release | Delegate to `claude --help` via `spawnSync` and pass output through |
| `shelljs` or `execa` | Wrappers around `child_process`; both have transitive deps | `node:child_process` directly — already used project-wide |
| TypeScript | Adds build step, `tsconfig.json`, and `tsc` dev dependency to a tool intentionally kept simple | Plain JS ESM — the codebase is ~700 LOC; manual review catches type bugs; adding TS now would require migrating all existing files |

## Stack Patterns by Variant

**For `teamclaude run --help` (defer to `claude --help`):**
- Use `spawnSync('claude', ['--help'], { stdio: 'inherit' })` — simplest possible; stdout/stderr flow directly to terminal, exit code is forwarded
- Do NOT capture and re-emit — that breaks ANSI colors and pager behavior

**For conflict detection (scan before forwarding):**
- Use `args.includes(flag)` or `argValue(flag)` for exact-match flags like `--api-url`, `--api-key`
- Emit warning to stderr (`process.stderr.write(...)`) then continue — warn-not-error per the key decision in PROJECT.md
- Check before `spawnSync` so the warning appears before Claude output

**For shell completion:**
- Bash: detect `COMP_LINE` / `COMP_POINT` env vars → call `spawnSync('claude', ['--completion', ...], { stdio: 'inherit' })`
- Zsh: same pattern via `_teamclaude` completion function in install docs
- Fish: `complete --command teamclaude --wraps claude` — one-liner, no code needed

**If claude binary is absent:**
- `spawnSync` returns `{ error: { code: 'ENOENT' } }` — already handled in `runCommand()`
- Same guard applies to `--help` delegation and completion forwarding

## Version Compatibility

| Component | Requirement | Notes |
|-----------|-------------|-------|
| Node.js `fetch` global | ≥18.0.0 | Used in `oauth.js` and `index.js` for API calls; unflagged since Node 18 |
| Node.js `node:test` | ≥18.0.0 | Built-in test runner available since Node 18 |
| `spawnSync` capture mode | all supported versions | `{ stdio: 'pipe' }` works since Node 0.11 |
| ESM `import ... from 'node:*'` | ≥14.18.0 (stable in 16+) | Already in use; `node:` prefix is the modern idiomatic form |
| Claude Code CLI | any installed version | Must not hardcode flag lists — read from binary at runtime to survive upgrades |

## Sources

- Codebase review (`src/index.js`, `src/server.js`, `package.json`, `eslint.config.js`) — HIGH confidence (source of truth)
- `node --version` output on host: v25.8.1 — HIGH confidence
- `claude --version` output on host: 2.1.138 (Claude Code) — HIGH confidence
- Node.js 18 LTS release notes (built-in fetch, `node:test`) — HIGH confidence
- PROJECT.md constraints section ("Node.js built-ins only") — HIGH confidence (explicit project decision)

---
*Stack research for: teamclaude CLI pass-through feature*
*Researched: 2026-05-10*
