---
id: 20260511-claude-statusline-footer
title: Claude Code statusline footer + accounts usage display
created: 2026-05-11
completed: 2026-05-11
status: complete
---

# Quick Task Summary

## Outcome

Added a `teamclaude statusline` subcommand that prints a one-line Claude Code
footer in the form `prefix s:XX% w:YY%`, and extended `teamclaude accounts`
to display live session/weekly quota usage with reset countdowns when the
proxy server is running.

## Changes

- `src/index.js`
  - Added `statusline` case to the top-level command switch.
  - Added helpers `fmtUsagePct`, `fmtResetDuration`, `accountPrefix`,
    `fetchProxyStatus` (best-effort 500-800 ms timeout, never throws).
  - Added `statuslineCommand()` — hits `/teamclaude/status`, prints
    `prefix s:XX% w:YY%` for the active account, falls back to
    `teamclaude (offline)` when the proxy is unreachable.
  - Extended `accountsCommand()` to fetch `/teamclaude/status` in parallel
    with profile lookups; renders `Session:`, `Weekly:`, and `Tokens:` lines
    per account when quota data is available. Marks the active account with
    a trailing `*`.
  - Added `statusline` line to `showHelp()`.
- `README.md`
  - Added a "Claude Code statusline footer" subsection with the
    `~/.claude/settings.json` snippet.
  - Annotated `teamclaude accounts` to mention live-quota display.

## Verification

- `node --check src/index.js` — passes.
- `node --test test/*.test.js` — 20/20 tests pass (no regressions).
- Local smoke: `node src/index.js statusline` against running proxy printed
  `jlq s:7% w:53%` — prefix correctly derived from `jlq@gladia.io`,
  exit code 0.
- `node src/index.js help` lists the new `statusline` subcommand.

## Files touched

- `src/index.js`
- `README.md`

## Notes

- Statusline output goes to stdout with no trailing newline (Claude Code
  convention).
- Offline fallback (`teamclaude (offline)`) ensures the statusline never
  disappears or errors mid-session.
- `accounts` keeps its previous output when the proxy is offline — added
  lines are purely additive.
