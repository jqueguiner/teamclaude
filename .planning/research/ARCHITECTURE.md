# Architecture Research

**Domain:** CLI proxy / multi-account credential manager
**Researched:** 2026-05-10
**Confidence:** HIGH (based on direct codebase analysis)

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Shell                               │
│   teamclaude run [flags...]   teamclaude server   teamclaude ... │
└───────────────────────┬─────────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────────┐
│                      src/index.js  (CLI entry point)             │
│  ┌──────────┐  ┌────────┐  ┌────────┐  ┌──────┐  ┌──────────┐  │
│  │  server  │  │  run   │  │ import │  │login │  │ accounts │  │
│  │ command  │  │command │  │command │  │ cmd  │  │  status  │  │
│  └────┬─────┘  └───┬────┘  └───┬────┘  └──┬───┘  └──────────┘  │
└───────┼────────────┼───────────┼───────────┼────────────────────┘
        │            │           │           │
        │            │     ┌─────▼───────────▼──────────────────┐
        │            │     │        src/oauth.js                 │
        │            │     │  importCredentials / loginOAuth     │
        │            │     │  refreshAccessToken / fetchProfile  │
        │            │     └────────────────────────────────────┘
        │            │
        │     ┌──────▼──────────────────────────────────────────┐
        │     │      spawnSync('claude', args)                   │
        │     │      env: ANTHROPIC_BASE_URL=http://localhost:N  │
        │     │      stdio: inherit (full terminal passthrough)  │
        │     └─────────────────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────────────────────────┐
│                  src/server.js  (HTTP proxy)                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  http.createServer → forwardRequest                     │    │
│  │  • Auth check (x-api-key or localhost bypass)           │    │
│  │  • /teamclaude/status endpoint                          │    │
│  │  • /v1/oauth/token passthrough (raw relay)              │    │
│  │  • Body buffer → retry-safe                             │    │
│  │  • SSE streaming with backpressure                      │    │
│  │  • Hop-by-hop header stripping                          │    │
│  │  • Usage extraction (SSE + JSON)                        │    │
│  └────────────────────┬────────────────────────────────────┘    │
└───────────────────────┼─────────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────────┐
│              src/account-manager.js  (quota state machine)       │
│  ┌────────────┐  ┌──────────────┐  ┌───────────┐  ┌──────────┐  │
│  │getActive   │  │ updateQuota  │  │ensureToken│  │ addAcct  │  │
│  │Account()   │  │ (ratelimit   │  │ Fresh()   │  │ removeAc │  │
│  │_selectNext │  │  headers)    │  │(coalesced)│  │ ct()     │  │
│  └────────────┘  └──────────────┘  └───────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────────────────────────┐
│                   src/config.js  (persistence)                   │
│  loadConfig / saveConfig / atomicConfigUpdate                    │
│  ~/.config/teamclaude.json  (mode 0o600)                        │
└─────────────────────────────────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────────────────────────┐
│                   src/tui.js  (optional TUI overlay)             │
│  Live account status, request log, config sync — TTY only       │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `src/index.js` | CLI command dispatch, server orchestration | `switch(command)` → async command functions |
| `src/server.js` | HTTP proxy: request routing, header rewriting, SSE streaming, retry | `http.createServer`, Node fetch for upstream |
| `src/account-manager.js` | Quota state machine: select, rotate, rate-limit, token refresh | In-memory account array with status/quota fields |
| `src/oauth.js` | OAuth PKCE flow, token refresh, credential import, profile fetch | Native `fetch`, `http.createServer` for callback |
| `src/config.js` | Config file I/O, atomic updates, path resolution | `readFile`/`writeFile` at `~/.config/teamclaude.json` |
| `src/tui.js` | Terminal UI overlay (TTY only) | Cursor manipulation, event hooks from server/account-manager |

## Current Project Structure

```
src/
├── index.js              # CLI entry + all command implementations
├── server.js             # HTTP reverse proxy
├── account-manager.js    # Quota/rotation state machine
├── oauth.js              # OAuth PKCE + token refresh + credential import
├── config.js             # JSON config persistence (atomic)
└── tui.js                # Terminal UI (TTY-only overlay)
```

### Structure Rationale

The flat `src/` layout is correct for this project size. Splitting further (e.g., `commands/`, `lib/`) would add indirection without benefit. The only natural future split would be pulling conflict-detection logic into `src/run-flags.js` once it grows.

## Architectural Patterns

### Pattern 1: Transparent `execvp`-style Passthrough

**What:** `spawnSync('claude', claudeArgs, { stdio: 'inherit' })` replaces the process's stdio with Claude's, so teamclaude disappears from the user's view entirely.
**When to use:** Always for the `run` command. This is the architectural invariant: the user should not be able to tell they're running through a wrapper.
**Trade-offs:** `spawnSync` blocks the Node process — correct for CLI, wrong for a server. The `run` command must never hold server state.

```javascript
// src/index.js — runCommand()
const result = spawnSync('claude', claudeArgs, {
  stdio: 'inherit',
  env: { ...process.env, ANTHROPIC_BASE_URL: `http://localhost:${port}` },
});
process.exit(result.status ?? 1);
```

### Pattern 2: Flag Pre-flight Scan (new work)

**What:** Before spawning `claude`, scan `claudeArgs` for flags that would conflict with the proxy environment (e.g., `--api-url`, `--api-key`, any flag that would override `ANTHROPIC_BASE_URL`). Emit a warning to stderr, then continue — warn, don't block.
**When to use:** In `runCommand()` before the `spawnSync` call.
**Trade-offs:** Static scan only — we don't re-implement Claude's parser. A flag we miss silently wins; a false positive we warn on is harmless noise. Err on the side of over-warning.

```javascript
// Proposed addition to runCommand()
const CONFLICTING_FLAGS = ['--api-url', '--api-key', '--base-url'];
for (const flag of CONFLICTING_FLAGS) {
  if (claudeArgs.includes(flag)) {
    console.warn(`[TeamClaude] Warning: "${flag}" conflicts with proxy setup and will be ignored.`);
  }
}
```

### Pattern 3: Help Delegation

**What:** `teamclaude run --help` calls `spawnSync('claude', ['--help'])` and exits — never buffers or reformats Claude's help output.
**When to use:** When `claudeArgs[0] === '--help'` or `claudeArgs[0] === '-h'`.
**Trade-offs:** Claude's help is always current; no flag list to maintain. The downside is that teamclaude-specific context (conflict warnings, proxy caveats) can't be injected into the help output. Accept this: document caveats in `teamclaude help` only.

```javascript
// Proposed addition to runCommand()
if (claudeArgs[0] === '--help' || claudeArgs[0] === '-h') {
  // Delegate directly — this exits with claude's exit code
  const result = spawnSync('claude', ['--help'], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}
```

### Pattern 4: Atomic Config Update

**What:** All config writes re-read the file from disk first, apply the mutation in memory, then write — preventing two concurrent processes from clobbering each other.
**When to use:** Any time config changes while the server is running (token refresh, TUI import, hot account sync).
**Trade-offs:** Not true atomic (no file lock) but close enough for single-user CLI use. Two simultaneous `teamclaude import` calls on the same file would still race; in practice this doesn't happen.

```javascript
// src/config.js
export async function atomicConfigUpdate(updater) {
  const config = await loadConfig() || createDefaultConfig();
  await updater(config);
  await saveConfig(config);
  return config;
}
```

### Pattern 5: Hook-based TUI Decoupling

**What:** The server and account-manager know nothing about the TUI. They call optional hooks (`onRequestStart`, `onRequestRouted`, `onRequestEnd`) that the server command wires up when running in TTY mode.
**When to use:** Any new observable event (e.g., account rotation, quota warning) should be exposed as a hook, not a direct TUI call.
**Trade-offs:** Slightly more indirection, but keeps `server.js` testable without a terminal.

## Data Flow

### Run Command Flow

```
User: teamclaude run --model opus "write a test"
         │
         ▼
runCommand() reads config (proxy port)
         │
         ▼
Conflict scan: check claudeArgs for --api-url etc.
         │ (warn if conflict found, continue)
         ▼
spawnSync('claude', ['--model', 'opus', 'write a test'], {
  stdio: 'inherit',
  env: { ...process.env, ANTHROPIC_BASE_URL: 'http://localhost:3456' }
})
         │
         ▼ (child process)
claude binary → sends request to ANTHROPIC_BASE_URL (proxy)
         │
         ▼
HTTP proxy receives POST /v1/messages
         │
         ▼
AccountManager.getActiveAccount() → picks account[N]
         │
         ▼
ensureTokenFresh(N) → refresh if expiring
         │
         ▼
fetch(upstream, { headers: { authorization: 'Bearer <token>' } })
         │
         ├── 200: stream SSE back to claude, parse usage headers
         ├── 429: wait retry-after, retry same account
         └── quota exceeded: rotate to next account, retry
```

### Account Rotation Decision Tree

```
getActiveAccount()
         │
         ▼
current account _isAvailable?
  YES → return current
  NO  → _selectNext()
           │
           ▼
        scan all accounts for _isAvailable
           │
           ├── found → update currentIndex, return
           └── none  → find soonest reset time
                           │
                           ├── reset time passed → activate, return
                           └── all exhausted → return null → 429 to client
```

### Token Refresh Flow

```
ensureTokenFresh(index)
         │
         ├── not OAuth OR no refreshToken → skip
         ├── token not expiring soon AND not forced → skip
         ├── _refreshPromise already in-flight → coalesce (await same promise)
         └── start refresh:
               refreshAccessToken(refreshToken)
                     │
                     ├── success → update credential/refreshToken/expiresAt
                     │            → call _onTokenRefresh (persists to disk)
                     └── failure → mark status='error' only if token already expired
```

## Scaling Considerations

This is a single-developer CLI tool. Scaling in the traditional sense (users, traffic) doesn't apply. The relevant "scaling" axes are:

| Axis | Current | If it grows |
|------|---------|-------------|
| Number of accounts | In-memory array, O(n) scan | Fine up to ~20 accounts; beyond that, a sorted heap by quota would help but is premature |
| Concurrent claude processes | One per `teamclaude run` call (each forks its own Node process) | No shared state between `run` invocations — they all hit the same server process, which handles concurrency correctly via async request handling |
| Config file contention | `atomicConfigUpdate` handles single-machine concurrency | Would need file locking for multi-machine setups (not in scope) |
| Flag list freshness | Currently no flag list stored | Delegating to `claude --help` means zero maintenance — this is the right call |

## Anti-Patterns

### Anti-Pattern 1: Static Flag Enumeration

**What people do:** Hard-code the list of Claude CLI flags in `teamclaude run --help` output (e.g., a big `console.log` block listing every `--model`, `--allowedTools`, etc.)
**Why it's wrong:** Claude's flag list changes with releases. A static copy becomes stale immediately and creates user confusion when flags exist but aren't listed, or listed flags change syntax.
**Do this instead:** Delegate `teamclaude run --help` directly to `claude --help` via `spawnSync`. Add a brief preamble (one line about the proxy) then exit. The flag list is always current.

### Anti-Pattern 2: Parsing Claude's `--help` Output

**What people do:** Spawn `claude --help`, capture stdout, parse the flag names out, then use that list for conflict detection or shell completion.
**Why it's wrong:** Claude's help format is undocumented and will change. Brittle regex against human-readable text is worse than not detecting conflicts at all.
**Do this instead:** Maintain a small, explicit allowlist of *known-conflicting* flags (`--api-url`, `--api-key`, etc.) in source — this list is stable because it's derived from teamclaude's own environment manipulation, not Claude's full flag surface.

### Anti-Pattern 3: Blocking the Server Process on `run`

**What people do:** Run `teamclaude run` in the same process that also runs `teamclaude server`, or call `run` without ensuring the server is already up.
**Why it's wrong:** The `run` command uses `spawnSync` which blocks the event loop. If the server is in the same process, it stops accepting connections for the duration of the claude session.
**Do this instead:** Server and run are separate process invocations. The server runs as a daemon (`teamclaude server`). `teamclaude run` is a short-lived CLI that connects to the already-running server.

### Anti-Pattern 4: Per-Flag Proxy Behavior

**What people do:** Intercept `--model opus` in `runCommand()` and change which account is selected (e.g., "use Max account for Opus").
**Why it's wrong:** Adds account-selection logic that couples model choice to account availability, creating invisible failures when the "right" account for a model is exhausted.
**Do this instead:** Account rotation is quota-driven only. Any account can serve any model; the proxy doesn't need to know which model is requested.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| `claude` binary | `spawnSync` with `stdio: 'inherit'` and env injection | The binary must be in PATH; ENOENT gives a clear error |
| `api.anthropic.com` | Node `fetch` (upstream proxy target) | Configurable via `config.upstream`; defaults to production |
| `platform.claude.com/v1/oauth/token` | `fetch` with retry + backoff | Used for token refresh; separate from main API upstream |
| `api.anthropic.com/api/oauth/profile` | `fetch` | Used to resolve account identity (UUID, email, tier) |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `index.js` ↔ `server.js` | Direct call: `createProxyServer(accountManager, config, hooks)` | Server is created and `.listen()` called by the command layer |
| `index.js` ↔ `account-manager.js` | Direct instantiation: `new AccountManager(accounts, threshold)` | AccountManager is stateful; one instance per server lifetime |
| `server.js` ↔ `account-manager.js` | Direct method calls: `getActiveAccount()`, `updateQuota()`, `ensureTokenFresh()` | Server holds a reference to the shared AccountManager instance |
| `server.js` ↔ `tui.js` | Optional hooks object: `{ onRequestStart, onRequestRouted, onRequestEnd }` | Hooks are no-ops when server runs headless (non-TTY) |
| `account-manager.js` ↔ `oauth.js` | Import: `refreshAccessToken`, `isTokenExpiringSoon` | AccountManager calls OAuth functions directly (no indirection) |
| `account-manager.js` → `index.js` | Callback: `onTokenRefresh(callback)` | Inverted dependency: AM fires a callback to persist tokens without importing config |

## The `run` Command Extension: Architectural Fit

The active work (flag discovery, conflict detection, `--help` delegation) fits cleanly into `runCommand()` in `src/index.js`. No new files are needed. The extension points are:

1. **Before `spawnSync`:** Conflict scan over `claudeArgs` — O(n) array scan, ~10 lines.
2. **Before `spawnSync` when `--help`:** Early-exit to `spawnSync('claude', ['--help'])`.
3. **Shell completion:** Shell-specific script (bash/zsh/fish) that calls `claude` completion directly — lives outside `src/`, in a `completions/` directory or generated at install time.

The `accountManager` and `server.js` are untouched by this work. Backward compatibility is guaranteed because `claudeArgs` is still passed through unchanged to `spawnSync` after the scan.

## Sources

- Direct codebase analysis: `src/index.js`, `src/server.js`, `src/account-manager.js`, `src/oauth.js`, `src/config.js` (2026-05-10)
- `.planning/PROJECT.md` — project constraints and key decisions
- Node.js documentation: `child_process.spawnSync`, `http.createServer` (built-in modules only constraint)

---
*Architecture research for: teamclaude CLI proxy / multi-account manager*
*Researched: 2026-05-10*
