---
id: 20260511-codex-gemini-backends
title: Codex + Gemini act-as-Claude backend accounts (CLI subprocess)
created: 2026-05-11
status: in-progress
---

# Plan: Codex + Gemini backend accounts

## Goal

Let teamclaude treat the local `codex` and `gemini` CLI binaries as full
peers of Claude OAuth/apikey accounts. When Claude Code routes a request
through such an account, teamclaude spawns the matching CLI in headless
mode, feeds it the conversation, and translates the CLI's structured
output into an Anthropic Messages response (JSON or SSE).

## Locked decisions (from /gsd:quick discussion)

1. **Backend mode:** CLI subprocess only. `codex exec --json` /
   `gemini -p ... --output-format stream-json`. No direct API calls.
   Auth is whatever the user already set up via `codex login` / `gemini`.
2. **Scope:** Streaming SSE, tool round-trips (best-effort, see Caveats),
   image inputs.
3. **Account type:** `type: 'codex'` / `type: 'gemini'` — peers of
   `oauth` / `apikey`. Each can be enabled / disabled like any other
   account (`disabled: true` field).

## Architecture

### New module: `src/cli-backend.js`

Single entry point used by `server.js`:

```js
export async function runCliBackend(account, requestBody, res) { ... }
```

Responsibilities:

- Parse the Anthropic request body (`{model, max_tokens, messages,
  system?, stream?, tools?, ...}`).
- Flatten messages history into a single prompt string. System message
  becomes a `<system>...</system>` prelude. Tool results become tagged
  blocks the CLI can read.
- For multimodal content: image content blocks get materialized to
  temp files. `codex exec -i FILE` accepts images. `gemini -p` doesn't
  have a documented image flag yet — pass image content as a textual
  "[image omitted]" placeholder with a console warning so behavior is
  predictable.
- Spawn the CLI as a child process. Stream stdout JSONL lines.
- Translate each CLI event into an Anthropic SSE event when the client
  requested streaming. For non-streaming requests, accumulate the text
  and respond with a single Anthropic Message JSON.
- On CLI failure (exit ≠ 0, ENOENT), emit a 502 with an Anthropic-shaped
  error.

### Stream translation table

| CLI event (gemini) | Anthropic SSE |
|---|---|
| `init` | `message_start` (placeholder usage) |
| first `message`(role=assistant, delta=true) | `content_block_start` (text) + `content_block_delta` |
| subsequent `message` deltas | `content_block_delta` |
| `result` (success) | `content_block_stop` + `message_delta` (stop_reason=end_turn, usage) + `message_stop` |
| `result` (error/status≠success) | `message_delta` (stop_reason=error) + `message_stop` |

| CLI event (codex `--json`) | Anthropic SSE |
|---|---|
| first event | `message_start` |
| agent text output | `content_block_*` text deltas |
| process exit 0 | `message_stop` + final `message_delta` |
| non-zero exit | error path |

Codex's `--json` schema isn't formally documented per release — implement
defensively: ignore unknown event types, fall back to reading the
`-o` last-message file at exit if the JSONL stream produced nothing.

### `src/server.js` dispatch

In `forwardRequest`, after `getActiveAccount()`:

```js
if (account.type === 'codex' || account.type === 'gemini') {
  ctx.account = account.name;
  return runCliBackend(account, body, res, accountManager, hooks, reqId);
}
```

CLI accounts skip:
- token refresh (`ensureTokenFresh`)
- upstream fetch
- rate-limit header parsing
- 429 retry-after loop (no upstream 429s)

Failures: account.status = 'error' → manager rotates to next account
(same path as upstream errors today).

### `src/account-manager.js` changes

1. Skip credential resolution for CLI types (`credential` stays null).
2. Add `disabled` per-account flag. `_isAvailable` returns false when
   `account.disabled === true` — the rotator skips disabled accounts.
3. `disabled` is exposed in `getStatus()` so TUI / `accounts` see it.

### `src/index.js` changes

New subcommands:

```
teamclaude login --codex      Verify `codex` is installed + logged in; add account
teamclaude login --gemini     Verify `gemini` is installed + logged in; add account
teamclaude enable <name>      Clear disabled flag
teamclaude disable <name>     Set disabled: true (rotator skips)
```

`accounts` listing: show `(codex)` / `(gemini)` type + `disabled`
marker; show backend version (`codex --version`) when available.

`resolveAccounts`: include codex/gemini accounts (no credentials).

### `src/config.js` changes

No schema change required — the account list is freeform JSON. New
account record shape:

```json
{ "name": "codex", "type": "codex" }
{ "name": "gemini", "type": "gemini" }
{ "name": "codex", "type": "codex", "disabled": true }
```

### Tests

Add `test/cli-backend.test.js`:
- Unit-test the message → prompt flattener (no subprocess spawn).
- Unit-test the gemini event → SSE translator with a captured fixture.
- Smoke-test that `runCliBackend` writes Anthropic-shaped JSON for a
  fake child process (mock `spawn`).

## Tasks

1. Add `src/cli-backend.js` with translators + spawner.
2. Wire dispatch in `src/server.js` for codex/gemini account types.
3. Extend `src/account-manager.js` with `disabled` flag handling.
4. Extend `src/index.js`: `login --codex`/`--gemini`, `enable`/`disable`,
   `accounts` rendering, `resolveAccounts` inclusion.
5. Document in `README.md`.
6. Add `test/cli-backend.test.js`.

## Caveats (documented, accepted)

- **Codex/Gemini CLIs are agents**, not raw LLM endpoints. They run
  their own tool loops (file edits, shell). When Claude Code sends a
  request with `tools: [...]` and expects `tool_use` content blocks
  back, teamclaude does **not** translate those tools into the CLI's
  tool protocol. The agent picks its own tools, executes them in its
  own sandbox, and we surface only its final text answer as an
  `assistant` content block. Net effect: claude code's tool harness
  becomes a no-op for these accounts; the agent handles work
  internally. This is the only path consistent with the locked
  "CLI subprocess" backend mode decision.
- **Image inputs** only flow through codex (`-i FILE`). Gemini CLI
  lacks a public image-input flag in the installed version — image
  content blocks get downgraded to a textual placeholder with a
  console warning.
- **Quota tracking** is approximate. Gemini emits token stats in its
  `result` event; codex doesn't. We log per-account request counts
  but the existing `unified5h` / `unified7d` quota gates do not apply
  to CLI backends (those are Anthropic Max constructs).

## Verification

- `node --check` passes on every modified `.js`.
- `node --test test/*.test.js` — all existing tests pass; new
  cli-backend test passes.
- Manual smoke (script in SUMMARY): start proxy with a codex/gemini
  account, send a non-streaming `/v1/messages` request, confirm
  Anthropic-shaped JSON in response.

## must_haves

- CLI account types (`codex`, `gemini`) round-trip a basic
  `messages.create`-style request and return Anthropic-shaped output.
- `disabled` flag toggles via `enable`/`disable` commands and the
  rotator skips disabled accounts.
- `accounts` command lists the new types alongside oauth/apikey.
- No regressions to existing OAuth/apikey paths (existing tests pass).
