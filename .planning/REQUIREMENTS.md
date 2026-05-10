# Requirements: teamclaude CLI Pass-Through

**Defined:** 2026-05-10
**Core Value:** Any `claude` invocation must work identically when prefixed with `teamclaude run` — zero surprises, zero flag loss.

## v1 Requirements

Requirements for this milestone (discoverability + conflict detection). Previously validated requirements are marked Complete in the traceability table.

### Help Delegation

- [ ] **HELP-01**: Running `teamclaude run --help` executes `claude --help` and pipes its output to stdout verbatim, with no modification
- [ ] **HELP-02**: `teamclaude run --help` exits with the same exit code returned by the `claude --help` subprocess
- [ ] **HELP-03**: `teamclaude run -h` is treated identically to `teamclaude run --help` (same delegation behavior, same exit code)
- [ ] **HELP-04**: When `claude --help` subprocess fails or is not found, `teamclaude run --help` exits non-zero and prints an actionable error to stderr

### Conflict Detection

- [ ] **CONF-01**: When `--api-url` is present in args, teamclaude prints a `[teamclaude WARNING]` message to stderr identifying `--api-url` as conflicting with the proxy's `ANTHROPIC_BASE_URL` setting
- [ ] **CONF-02**: When `--api-key` is present in args, teamclaude prints a `[teamclaude WARNING]` message to stderr identifying `--api-key` as conflicting with proxy-managed credentials
- [ ] **CONF-03**: After printing any conflict warning, teamclaude still spawns `claude` with the user's args unchanged — warnings do not block execution
- [ ] **CONF-04**: Each conflict warning names the specific flag, describes why it conflicts with the proxy, and suggests an alternative or workaround
- [ ] **CONF-05**: Conflict warnings are written exclusively to stderr; stdout contains only `claude` subprocess output

### Passthrough Behavior

- [ ] **PASS-01**: `teamclaude run <flags> <prompt>` spawns `claude <flags> <prompt>` with inherited stdio, producing output byte-for-byte identical to running `claude` directly
- [ ] **PASS-02**: `teamclaude run -- <args>` strips the `--` separator and passes remaining args to `claude` unmodified
- [ ] **PASS-03**: The exit code of `teamclaude run` always matches the exit code of the underlying `claude` process

### Backward Compatibility

- [ ] **COMPAT-01**: Any `teamclaude run <args>` invocation that succeeded before conflict detection is added continues to produce identical stdout output and exit codes
- [ ] **COMPAT-02**: Adding conflict warnings does not alter the exit code for invocations that do not trigger any conflict (valid invocations exit 0 when `claude` exits 0)
- [ ] **COMPAT-03**: Conflict warnings on stderr do not corrupt stdout, so scripts that capture `teamclaude run` stdout continue to work correctly

### Account Management (validated in v1.0)

- [ ] **ACCT-01**: teamclaude rotates to the next available account when the active account's quota reaches 98%
- [ ] **ACCT-02**: teamclaude refreshes an OAuth token automatically when it is within 5 minutes of expiry, before spawning `claude`
- [ ] **ACCT-03**: On a 429 response, teamclaude retries after the duration specified in the `retry-after` header
- [ ] **ACCT-04**: `teamclaude import --json <credentials>` accepts inline JSON credential input and stores it correctly

### Server (validated in v1.0)

- [ ] **SERV-01**: `teamclaude server` starts the proxy server and listens for incoming requests
- [ ] **SERV-02**: `teamclaude server --log-to <path>` writes all server-side log output to the file at `<path>`

### Error Handling

- [ ] **ERR-01**: When the `claude` binary is not found on PATH, teamclaude exits with a non-zero code and prints an actionable error to stderr (e.g., "claude not found — install Claude Code CLI and ensure it is on PATH")
- [ ] **ERR-02**: When account rotation finds no accounts below the 98% threshold, teamclaude exits non-zero with a message listing available accounts and their quota states
- [ ] **ERR-03**: Unhandled exceptions in the teamclaude process print a human-readable message to stderr and exit non-zero rather than printing a raw stack trace

### Logging

- [ ] **LOG-01**: All teamclaude-generated diagnostic output (warnings, errors, rotation events) is written to stderr, never to stdout
- [ ] **LOG-02**: teamclaude-generated messages are prefixed with `[teamclaude WARNING]` or `[teamclaude ERROR]` to distinguish them from `claude` subprocess output
- [ ] **LOG-03**: When `--log-to <path>` is active on the server, rotation and token-refresh events are written to the log file with ISO 8601 timestamps

## v2 Requirements

Deferred to a future release. Not in the current roadmap.

### Shell Completion

- **COMP-01**: `teamclaude run <TAB>` forwards the completion query to `claude`'s own completion mechanism and returns the same completions a user would get from `claude <TAB>`
- **COMP-02**: Shell completion works for bash, zsh, and fish shells
- **COMP-03**: Installing teamclaude shell completion does not require modifying the user's `claude` completion setup

### Extended Conflict Detection

- **CONF-06**: Any `ANTHROPIC_*` environment variable set in the calling environment that would override teamclaude's proxy configuration is detected and warned about at startup
- **CONF-07**: The conflict registry is documented so contributors can add new entries without changing detection logic

### Observability

- **OBS-01**: `teamclaude status` prints the current account, its quota percentage, and time until next token refresh
- **OBS-02**: Rotation events are emitted as structured JSON lines when `--log-to` is active, enabling log aggregation

## Out of Scope

| Feature | Reason |
|---------|--------|
| Re-implementing Claude's flag parser in teamclaude | Any divergence from `claude`'s actual parser is a bug; impossible to keep in sync — delegate parsing to the binary entirely |
| Per-flag account selection (e.g., use account B for `--model opus`) | Couples account management to model availability; quota math becomes non-deterministic; rotation at 98% already handles capacity |
| Blocking (hard error) on conflicting flags | Breaks existing user scripts; warn to stderr and proceed so users can migrate on their own schedule |
| Static hardcoded flag list in `teamclaude run --help` | Rots on every `claude` release; runtime delegation to `claude --help` is zero-maintenance |
| GUI or web dashboard for flag/account configuration | CLI-first users don't need it; adds a maintenance surface with no quota benefit |
| Supporting legacy API-key-only `claude` flags | These accounts are handled separately via `teamclaude login --api`; out of scope for OAuth/Max proxy |
| Per-account flag compatibility checking (`--model` vs. plan tier) | Quota rotation already handles capacity implicitly; add only if users hit this in practice |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| HELP-01 | Phase 1 | Pending |
| HELP-02 | Phase 1 | Pending |
| HELP-03 | Phase 1 | Pending |
| HELP-04 | Phase 1 | Pending |
| CONF-01 | Phase 2 | Pending |
| CONF-02 | Phase 2 | Pending |
| CONF-03 | Phase 2 | Pending |
| CONF-04 | Phase 2 | Pending |
| CONF-05 | Phase 2 | Pending |
| PASS-01 | Phase 1 | Complete |
| PASS-02 | Phase 1 | Complete |
| PASS-03 | Phase 1 | Pending |
| COMPAT-01 | Phase 1 | Pending |
| COMPAT-02 | Phase 1 | Pending |
| COMPAT-03 | Phase 1 | Pending |
| ACCT-01 | Phase 0 | Complete |
| ACCT-02 | Phase 0 | Complete |
| ACCT-03 | Phase 0 | Complete |
| ACCT-04 | Phase 0 | Complete |
| SERV-01 | Phase 0 | Complete |
| SERV-02 | Phase 0 | Complete |
| ERR-01 | Phase 1 | Pending |
| ERR-02 | Phase 2 | Pending |
| ERR-03 | Phase 2 | Pending |
| LOG-01 | Phase 2 | Pending |
| LOG-02 | Phase 2 | Pending |
| LOG-03 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 27 total
- Phase 0 (complete): 6
- Phase 1 (pending): 11 (HELP-01-04, PASS-01-03, COMPAT-01-03, ERR-01)
- Phase 2 (pending): 10 (CONF-01-05, ERR-02-03, LOG-01-03)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-10*
*Last updated: 2026-05-10 after initial definition from PROJECT.md + feature research*
