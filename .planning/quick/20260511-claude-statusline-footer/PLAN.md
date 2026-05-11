---
id: 20260511-claude-statusline-footer
title: Claude Code statusline footer + accounts usage display
created: 2026-05-11
status: in-progress
---

# Quick Task: Claude Code Statusline Footer + Accounts Usage

## Goal

Surface live TeamClaude quota usage in two places:

1. **Claude Code statusline** — bottom-of-screen footer rendered by Claude Code
   via its `statusLine` setting. Format: `prefix s:XX% w:YY%` where
   - `prefix` = portion of the active account name (email) before `@`
   - `s` = session (5h) utilization percentage of active account
   - `w` = weekly (7d) utilization percentage of active account

2. **`teamclaude accounts` output** — extend each row to show session/weekly
   utilization and reset countdown when proxy is running.

## Approach

### 1. New subcommand `teamclaude statusline`

- Hits `/teamclaude/status` on the configured proxy port with a 500ms timeout.
- On success: extracts `currentAccount`, finds its quota, computes prefix
  (`name.split('@')[0]`), prints one line: `prefix s:XX% w:YY%`.
- On any failure (proxy down, no quota yet, missing data): print a
  silent-friendly stub like `teamclaude (offline)` or empty — never throws.
- Must exit fast (Claude Code reruns statusline ~every few seconds).
- Output goes to stdout, no trailing newline (statusline convention).

### 2. Extend `teamclaude accounts`

- Add a best-effort fetch of `/teamclaude/status` before listing.
- For each OAuth account, if quota data is present:
  - `Session: XX% (resets in Yh Zm)`
  - `Weekly:  YY% (resets in Ad Bh)`
- If proxy unreachable, just skip the usage lines (existing behaviour unchanged).
- Format reset duration using the same algorithm as `tui.js:formatReset`.

### 3. Help text + README

- Add `statusline` to `showHelp()` listing.
- Add a short README snippet showing the `~/.claude/settings.json` config:
  ```json
  { "statusLine": { "type": "command", "command": "teamclaude statusline" } }
  ```

## Files to touch

- `src/index.js` — add `statuslineCommand()`, extend `accountsCommand()`, update `showHelp()`
- `README.md` — add brief statusline integration section

## Non-goals

- No new dependencies.
- No changes to the proxy or account-manager (status endpoint already
  exposes everything needed).
- No automatic install of statusLine config (user opt-in).

## Verification

- `teamclaude statusline` with proxy running prints `prefix s:NN% w:NN%`.
- `teamclaude statusline` with proxy down prints offline stub, exits 0 quickly.
- `teamclaude accounts` shows usage + reset when proxy is running, falls back
  to current display when not.
- Existing `node --test` suite passes.
