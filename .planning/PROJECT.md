# teamclaude: Full Claude Code CLI Pass-Through

## What This Is

teamclaude is a multi-account proxy for Claude Code that enables automatic OAuth account rotation when one account approaches its quota. It wraps the `claude` CLI so developers can run multiple Claude accounts transparently. This work extends the `run` command from a blind passthrough to an explicitly documented, discoverable surface that mirrors every flag Claude Code CLI accepts.

## Core Value

Any `claude` invocation must work identically when prefixed with `teamclaude run` — zero surprises, zero flag loss.

## Requirements

### Validated

- ✓ Transparent `claude` arg passthrough via `spawnSync('claude', claudeArgs)` — v1.0
- ✓ Automatic account rotation at 98% quota threshold — v1.0
- ✓ OAuth token auto-refresh within 5-minute expiry window — v1.0
- ✓ 429 retry with `retry-after` respect — v1.0
- ✓ `teamclaude server` with `--log-to` flag — v1.0
- ✓ `teamclaude import --json` for inline credential input — v1.0.6

### Active

- [ ] Enumerate all Claude Code CLI flags in `teamclaude run --help` output — model selection (`--model`), permission modes (`--allowedTools`, `--disallowedTools`), MCP config (`--mcp-config`), working directory (`--cwd`), output format (`--output-format`), session flags (`--resume`, `--continue`, `--session-id`), non-interactive mode (`--print`, `--no-ansi`), and any other flags from `claude --help`
- [ ] Detect and document any flags that conflict with teamclaude's proxy setup (e.g., `--api-url` would override `ANTHROPIC_BASE_URL`) — warn the user rather than silently breaking
- [ ] Shell completion for `teamclaude run <TAB>` that forwards to `claude`'s own completion
- [ ] Validate that `teamclaude run --help` defers cleanly to `claude --help` so the flag list stays current without manual maintenance

### Out of Scope

- Re-implementing Claude's flag parser in teamclaude — we delegate parsing to the `claude` binary; our job is discovery and conflict detection, not reimplementation
- Modifying proxy behavior per-flag (e.g., different account selection for `--model opus`) — adds complexity with no quota benefit; account rotation already handles capacity
- GUI or web dashboard for flag configuration — CLI-first users don't need it; the TUI is sufficient
- Supporting `claude` flags that predate the OAuth/Max account model (legacy API-key-only flags) — these accounts are handled separately via `teamclaude login --api`

## Context

The `run` command already passes all args through blindly (`spawnSync('claude', claudeArgs)` with inherited stdio), so the underlying passthrough is correct. The gap is discoverability: users don't know which flags are available without consulting `claude --help` separately, and some flags (particularly anything touching `ANTHROPIC_BASE_URL` or API key configuration) will silently conflict with the proxy.

The main flags Claude Code CLI accepts as of Claude Code v1.x:
- **Model**: `--model <id>` (e.g., `claude-opus-4-7`, `claude-sonnet-4-6`)
- **Permissions**: `--allowedTools`, `--disallowedTools`, `--permission-mode` (auto/default/bypassPermissions)
- **MCP**: `--mcp-config <path>`, `--add-dir <path>`
- **Session**: `--resume [session-id]`, `--continue`, `--session-id <id>`
- **Output**: `--output-format` (text/json/stream-json), `--no-ansi`, `--verbose`
- **Non-interactive**: `--print` / `-p`, `--max-turns <n>`, `--system-prompt <str>`, `--append-system-prompt <str>`
- **Working dir**: `--cwd <path>` (alternative: just `cd` before `teamclaude run`)
- **Dangerously skip permissions**: `--dangerously-skip-permissions`

The `--` separator handling is already implemented (strips it before passing to claude).

Node.js built-in modules only — no dependencies to add for this feature.

## Constraints

- **Tech Stack**: Node.js built-ins only — no npm packages; matches existing zero-dependency constraint
- **Compatibility**: Must work with whatever `claude` version is installed; cannot hardcode flag lists that go stale — prefer delegating `--help` to the binary
- **Conflict Safety**: `ANTHROPIC_BASE_URL` is set by teamclaude to point at the proxy; any flag that overrides this must be caught and rejected with a clear error message
- **Backward Compatibility**: Existing `teamclaude run <args>` invocations must continue to work unchanged — this is additive only

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Delegate `--help` to `claude --help` rather than maintaining our own flag list | Claude's flag list changes with releases; a static copy would rot immediately | — Pending |
| Warn (not error) on conflicting flags like `--api-url` | Users may have scripts; fail loudly but don't break existing workflows | — Pending |
| Shell completion by forwarding to `claude`'s completion mechanism | Avoids duplicating completion logic; stays current automatically | — Pending |
| No per-flag proxy behavior changes | Keeps AccountManager logic simple; quota math doesn't depend on model or output format | — Pending |

---
*Last updated: 2026-05-10 after initial project scoping — full CLI pass-through feature*
