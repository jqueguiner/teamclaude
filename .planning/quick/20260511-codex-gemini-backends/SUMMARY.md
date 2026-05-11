---
id: 20260511-codex-gemini-backends
title: Codex + Gemini act-as-Claude backend accounts (CLI subprocess)
created: 2026-05-11
completed: 2026-05-11
status: complete
---

# Quick Task Summary

## Outcome

Added two new account types — `codex` and `gemini` — that route Claude
Code requests through the local `codex` and `gemini` CLI binaries
running in headless mode. The proxy translates between the Anthropic
Messages API (what Claude Code speaks) and each CLI's structured
JSON-line output, so the upstream model can be transparently swapped
for Codex or Gemini when Claude quota is exhausted. Accounts can be
toggled via `teamclaude disable <name>` / `enable <name>`.

## Locked decisions (from /gsd:quick discussion)

| Axis | Decision |
|---|---|
| Backend mode | CLI subprocess (`codex exec --json` / `gemini -p ... --output-format stream-json -y`) — no direct API calls |
| Scope | Streaming SSE + tool *passthrough* (best-effort; see Caveats) + image inputs |
| Account type | `type: 'codex'` / `type: 'gemini'` — peers of OAuth/apikey, with `disabled: true` opt-out flag |

## Changes

- **`src/cli-backend.js` (new, 396 LOC)**
  - `isCliBackend(type)` — predicate for `codex` / `gemini`.
  - `probeCliInstalled(type)` — runs `<bin> --version`, returns
    `{ok, version, error}`. Used by `login` pre-flight and server-start
    `resolveAccounts`.
  - `flattenMessages(body)` — turns an Anthropic Messages payload into
    a single text prompt with `<system>` / `<user>` / `<assistant>` /
    `<tool_use>` / `<tool_result>` tagged blocks; trailing
    `<assistant>` invites the model's continuation.
  - `geminiEventToAnthropic(event, state, msgId, model)` — pure
    translator from gemini stream-json events to Anthropic SSE chunks.
    Handles `init` → `message_start`, `message` (assistant deltas) →
    `content_block_start` (once) + `content_block_delta`,
    `result` → `content_block_stop` + `message_delta` (stop_reason +
    usage from `stats.input_tokens` / `stats.output_tokens`) +
    `message_stop`.
  - `codexEventToAnthropic(event, state, msgId, model)` — same
    translator for codex `--json` output. Defensive against shape
    drift across releases (handles `agent_message`, `msg.agent_message`,
    nested `item.content`, etc.).
  - `runCliBackend(account, body, res, am, hooks, reqId)` — top-level
    entry: spawns the subprocess (codex via stdin, gemini via `-p`),
    materializes any image content blocks to a temp dir for codex's
    `-i FILE` flag, runs the streaming or buffered pipeline depending
    on `payload.stream`, falls back to codex's `-o LAST_MSG` file when
    the JSONL stream produces nothing usable.
- **`src/server.js`** — after `getActiveAccount()`, dispatch to
  `runCliBackend` for `codex` / `gemini` accounts. Skips token
  refresh, upstream fetch, and rate-limit header parsing for these
  accounts. Surfaces CLI-backend errors as Anthropic-shaped 502s.
- **`src/account-manager.js`**
  - Tolerates accounts without credentials (CLI backends).
  - New per-account `disabled` flag (boolean). `_isAvailable` returns
    false for disabled accounts; `getStatus()` surfaces it.
  - Codex / Gemini accounts skip quota gates (those are Anthropic
    constructs that don't apply).
  - `addAccount()` carries the disabled flag for runtime adds.
- **`src/index.js`**
  - New top-level commands: `login --codex`, `login --gemini`,
    `enable <name>`, `disable <name>`.
  - Interactive `login` menu gains options 3/4 for the CLI backends.
  - `loginCliBackendCommand(type)` — pre-flights the binary, writes a
    new `{name, type, source: 'cli'}` account, prints the
    tool-passthrough caveat so the user has informed consent.
  - `toggleAccountCommand(disable)` — flips the `disabled` flag.
  - `resolveAccounts()` includes codex/gemini accounts; warns on
    startup if the binary is missing.
  - `accountsCommand` renders codex/gemini rows with the binary
    version and `[disabled]` tag where applicable; also surfaces the
    `[disabled]` tag on OAuth/apikey rows.
  - `showHelp()` lists the new subcommands.
- **`test/cli-backend.test.js` (new)** — 11 unit tests covering
  `isCliBackend`, `flattenMessages` (system + role ordering, content
  blocks, images, tool_use/tool_result), and both event translators
  (init → start, delta accumulation, result with usage,
  failure → stop_reason=error, codex shape variants, codex
  `task_complete`).
- **`README.md`** — new "Codex / Gemini CLI backends (act-as-Claude)"
  section under Adding Accounts; `enable` / `disable` lines in the
  command list.

## Verification

- `node --check src/{cli-backend,server,account-manager,index}.js` —
  all four files parse cleanly.
- `node --test test/*.test.js` — **31/31** pass (20 existing +
  11 new). No regressions.
- End-to-end smoke against the real binaries (TEAMCLAUDE_CONFIG=/tmp/tc-test.json):
  - `login --codex` → "Detected codex: codex-cli 0.128.0" → account written.
  - `login --gemini` → "Detected gemini: 0.41.2" → account written.
  - `accounts` → renders both with version tags: `[1] codex (codex) codex-cli 0.128.0`.
  - `disable codex` → next `accounts` shows `[disabled]`. `enable codex` clears it.

## Files touched

- `src/cli-backend.js` (new)
- `src/server.js`
- `src/account-manager.js`
- `src/index.js`
- `test/cli-backend.test.js` (new)
- `README.md`

## Caveats (carry-forward)

- Codex/Gemini CLIs are *agents*, not raw LLM endpoints. Anthropic
  `tools` arrays sent by Claude Code do **not** translate into the
  CLI's tool protocol — the agent picks its own tools, executes them
  in its own sandbox, and we surface only the final text answer as a
  single `assistant` content block. This is the only path consistent
  with the locked "CLI subprocess" backend mode.
- Image inputs only flow through codex (`-i FILE`). The installed
  gemini CLI lacks a documented image-input flag, so image content
  blocks become `[image #N]` placeholders for that backend.
- No quota tracking for CLI backends — codex emits no token stats and
  gemini's stats arrive only on `result`. Per-account request counts
  are still tracked; the `unified5h` / `unified7d` gates simply don't
  apply (they're Anthropic constructs).
- Codex's `--json` event schema can drift release-to-release. The
  parser is intentionally tolerant (ignores unknown events, falls
  back to the `-o LAST_MSG` file) but a release that renames event
  types entirely would need an update to `extractCodexText` /
  `isCodexDone` in `src/cli-backend.js`.
