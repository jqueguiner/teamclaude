# Feature Research

**Domain:** CLI proxy / multi-account wrapper for Claude Code
**Researched:** 2026-05-10
**Confidence:** HIGH — requirements are fully specified in PROJECT.md; this is not ecosystem discovery but feature decomposition of a known scope

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `teamclaude run --help` defers to `claude --help` | Any CLI wrapper must surface the wrapped binary's help — users will type `--help` first | LOW | Parse `claude --help` output at runtime via `execSync`; pipe to stdout; no static copy |
| Conflict detection with clear error messages | `--api-url` or `ANTHROPIC_API_KEY` override silently breaks proxy routing; users expect loud failures not silent misbehavior | MEDIUM | Intercept known conflicting flags before spawning; print actionable error naming the conflict |
| Transparent passthrough of all valid flags | Core value proposition: `teamclaude run <anything>` must behave identically to `claude <anything>` | LOW | Already implemented via `spawnSync` with inherited stdio; this is about discoverability |
| `--` separator handling | Power users pipe `--` to separate tool args from prompt args; missing this breaks scripted workflows | LOW | Already implemented — strip `--` before passing to claude |
| Backward-compatible invocation | Existing scripts using `teamclaude run <args>` must not break when new detection logic is added | LOW | Additive only — detection/warnings must not change exit codes for valid invocations |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Shell completion forwarding (`teamclaude run <TAB>`) | Developers who rely on tab-completion for `claude` flags lose it when switching to `teamclaude run`; restoring it removes friction | MEDIUM | Forward completion query to `claude`'s own completion mechanism; shell-specific (bash/zsh/fish) |
| Conflict warning (not hard error) for known bad flags | Users may have scripts they can't immediately change; warn loudly but allow them to proceed or override | LOW | Print `[teamclaude WARNING]` to stderr; proceed with spawn; document override mechanism |
| Runtime flag discovery (no hardcoded list) | A hardcoded flag list rots with each `claude` release; dynamic discovery means `teamclaude` stays correct automatically | MEDIUM | At `--help` time, exec `claude --help` and pass through; never maintain a static flag registry |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Per-flag account selection (e.g., use account B for `--model opus`) | Seems like fine-grained control | Couples account management to model availability; breaks when accounts have different plan tiers; quota math becomes non-deterministic | Account rotation already handles capacity — rotation at 98% threshold is model-agnostic |
| Static hardcoded flag list in `teamclaude run --help` | Looks polished; no subprocess needed | Rots immediately on every `claude` release; creates false sense of completeness; users report "missing" flags that were recently added to claude | Delegate `--help` entirely to `claude --help` |
| GUI/web dashboard for flag configuration | Perceived as "professional" | CLI-first users don't use it; adds a maintenance surface with no quota benefit; the TUI is sufficient | Keep it CLI-only |
| Re-implementing Claude's flag parser | Enables stricter validation | Any divergence from claude's actual parser is a bug; impossible to keep in sync without parsing claude's source | Delegate parsing to the binary entirely |
| Blocking on conflicting flags (hard error) | Seems safer | Breaks existing user scripts that have `--api-url` hardcoded for other reasons; forces immediate migration | Warn to stderr, still spawn; let user decide |

## Feature Dependencies

```
[Shell completion forwarding]
    └──requires──> [Runtime --help delegation]
                       └──requires──> [execSync('claude --help') works at runtime]

[Conflict detection]
    └──requires──> [Known conflict registry (--api-url, ANTHROPIC_API_KEY flags)]

[teamclaude run --help output]
    └──requires──> [Runtime --help delegation]
    └──enhances──> [Shell completion forwarding]

[Backward-compatible passthrough]
    └──must-not-break──> [Conflict detection warnings]
```

### Dependency Notes

- **Shell completion forwarding requires runtime --help delegation:** Both depend on exec'ing `claude` to get current information; implement `--help` delegation first, then completion piggybacks on the same pattern.
- **Conflict detection requires a known conflict registry:** This is the ONE place a hardcoded list is acceptable — not flags, but flags that break the proxy's `ANTHROPIC_BASE_URL` override. The list is short and stable: `--api-url`, `--api-key`, any `ANTHROPIC_*` env-passthrough flags.
- **Backward-compatible passthrough must not break under conflict detection:** Warnings go to stderr only; exit code stays 0 for warnings; only hard-error on conflicts that would cause definite breakage (not just potential).

## MVP Definition

### Launch With (this milestone)

Minimum scope to close the discoverability and conflict-safety gaps.

- [ ] `teamclaude run --help` delegates to `claude --help` — closes the "where are the flags?" gap; zero maintenance cost
- [ ] Conflict detection for `--api-url` with stderr warning — closes the silent-breakage gap for the most dangerous flag
- [ ] Conflict detection for any flag that would override `ANTHROPIC_BASE_URL` — same rationale; these are the only flags that break proxy routing

### Add After Validation (v1.x)

- [ ] Shell completion forwarding — add once `--help` delegation is stable; depends on same mechanism
- [ ] Expand conflict registry to cover edge cases discovered in real usage — driven by bug reports, not speculation

### Future Consideration (v2+)

- [ ] Machine-readable flag metadata from `claude --help` for richer TUI display — only if TUI complexity warrants it; don't build infrastructure speculatively
- [ ] Per-account flag compatibility checking (e.g., `--model` value vs. account plan) — only if users hit this in practice; quota rotation already handles it implicitly

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `--help` delegation to `claude --help` | HIGH | LOW | P1 |
| Conflict detection for `--api-url` | HIGH | LOW | P1 |
| Conflict warning (stderr, not hard error) | HIGH | LOW | P1 |
| Shell completion forwarding | MEDIUM | MEDIUM | P2 |
| Expand conflict registry beyond `--api-url` | MEDIUM | LOW | P2 |
| Machine-readable flag metadata | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for this milestone
- P2: Should have, add when P1s are stable
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Direct CLI wrappers (e.g., `gh`, `git-extras`) | Shell aliases/functions | teamclaude approach |
|---------|------------------------------------------------|------------------------|---------------------|
| Help passthrough | `gh` delegates `--help` to subcommand — well-established pattern | Aliases lose `--help` entirely | Delegate to `claude --help` at runtime |
| Conflict detection | Rarely done; most wrappers trust users | No detection possible | Explicit conflict registry for proxy-breaking flags |
| Shell completion | Custom completion scripts, often stale | Lost entirely | Forward to `claude`'s completion mechanism |
| Flag list maintenance | Hardcoded (stale risk) | N/A | Zero maintenance via runtime delegation |

**Key insight:** The `gh` CLI pattern (subcommand help delegates to the wrapped API) is the right model. `gh api --help` doesn't describe all GitHub API endpoints — it describes the `gh api` wrapper behavior and defers to the API docs for the rest. Same principle applies here: `teamclaude run --help` describes teamclaude's wrapper behavior (conflict warnings, account rotation context) and defers to `claude --help` for the full flag list.

## Sources

- PROJECT.md — primary requirements and constraints (HIGH confidence — authoritative)
- Claude Code CLI flag list in PROJECT.md context section (MEDIUM confidence — snapshot from v1.x; runtime delegation makes staleness moot)
- `gh` CLI help delegation pattern — established prior art for wrapper CLIs (MEDIUM confidence — pattern well-known, not formally cited)

---
*Feature research for: teamclaude CLI pass-through (discoverability + conflict detection)*
*Researched: 2026-05-10*
