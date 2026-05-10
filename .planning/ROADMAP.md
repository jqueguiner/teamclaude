# Roadmap: teamclaude CLI Pass-Through

## Overview

teamclaude's proxy foundation is already shipped: account rotation, OAuth refresh, and server management are complete in Phase 0. This milestone makes `teamclaude run` a fully discoverable, conflict-safe replacement for direct `claude` invocations. Phase 1 delivers help delegation and passthrough correctness — the table-stakes features that make the tool trustworthy. Phase 2 adds conflict detection and consistent error/logging discipline so users never silently break their proxy setup.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 0: Foundation** - Account rotation, OAuth refresh, server, import — shipped in v1.0
- [ ] **Phase 1: Help Delegation & Passthrough Safety** - `teamclaude run --help` delegates to `claude`; passthrough is exact and exit codes match
- [ ] **Phase 2: Conflict Detection & Reliability** - Proxy-conflicting flags warn to stderr; errors and logging are consistent and production-ready

## Phase Details

### Phase 0: Foundation
**Goal**: Core proxy infrastructure is operational
**Depends on**: Nothing
**Requirements**: ACCT-01, ACCT-02, ACCT-03, ACCT-04, SERV-01, SERV-02
**Success Criteria** (what must be TRUE):
  1. teamclaude rotates to a new account when active account hits 98% quota
  2. OAuth tokens refresh automatically within 5 minutes of expiry before spawning `claude`
  3. 429 responses trigger a retry after the `retry-after` header duration
  4. `teamclaude server --log-to <path>` starts and writes logs to the specified file
**Plans**: Complete
**Status**: Complete — shipped v1.0

### Phase 1: Help Delegation & Passthrough Safety
**Goal**: Users can discover what flags `teamclaude run` supports and trust that passthrough produces identical output to running `claude` directly
**Depends on**: Phase 0
**Requirements**: HELP-01, HELP-02, HELP-03, HELP-04, PASS-01, PASS-02, PASS-03, COMPAT-01, COMPAT-02, COMPAT-03, ERR-01
**Success Criteria** (what must be TRUE):
  1. `teamclaude run --help` and `teamclaude run -h` both show a teamclaude proxy header followed by verbatim `claude --help` output, exiting with the same code `claude --help` returns
  2. When the `claude` binary is not on PATH, teamclaude exits non-zero and prints an actionable "claude not found" message to stderr
  3. `teamclaude run <any-flags> <prompt>` produces byte-for-byte identical stdout to running `claude <any-flags> <prompt>` directly
  4. Exit code of `teamclaude run` always equals the exit code of the underlying `claude` process
  5. Existing scripts capturing `teamclaude run` stdout continue to work without modification after this phase ships
**Plans**: TBD

### Phase 2: Conflict Detection & Reliability
**Goal**: Users are warned before proxy-conflicting flags silently break routing, and all teamclaude-generated output is consistent and clearly distinguishable from `claude` output
**Depends on**: Phase 1
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04, CONF-05, ERR-02, ERR-03, LOG-01, LOG-02, LOG-03
**Success Criteria** (what must be TRUE):
  1. Running `teamclaude run --api-url <url>` prints a `[teamclaude WARNING]` to stderr naming the conflict and suggesting an alternative; `claude` still executes normally
  2. Running `teamclaude run --api-key <key>` prints a `[teamclaude WARNING]` to stderr identifying the credential conflict; execution is not blocked
  3. When account rotation finds no accounts below the 98% threshold, teamclaude exits non-zero and lists all available accounts with their quota states
  4. Unhandled exceptions print a human-readable `[teamclaude ERROR]` message to stderr (never a raw stack trace) and exit non-zero
  5. All teamclaude-generated output (warnings, errors, rotation events) appears exclusively on stderr; stdout carries only `claude` subprocess output
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Foundation | - | Complete | 2026-05-10 |
| 1. Help Delegation & Passthrough Safety | 0/TBD | Not started | - |
| 2. Conflict Detection & Reliability | 0/TBD | Not started | - |
