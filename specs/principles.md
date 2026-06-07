# Principles

The slack-axi philosophy, written down as decisive rules. Each picks a side of a real trade-off so an
implementer resolves an unspecified case the way the design intends. These exist because the tool they
replace (the claude.ai Slack MCP) failed in ways that trace back to violating them — each principle
names the pain it prevents.

## The agent never computes time

Slack's API takes raw epoch `oldest`/`latest`. Agents have queried 2025 timestamps meaning 2026 and
gotten plausible, year-old data back — silently corrupting downstream records. Therefore: commands
**accept human time** (`--from 2026-04-23`, `--since 7d`) and **never require the agent to produce an
epoch**. Every command that resolves a window **echoes the resolved range back in the output header
with an explicit year and timezone** so a year-off mistake is caught at a glance. If we must choose
between a terse header and one that re-states the resolved dates, always re-state them.

> Prevents: year-wrong timestamps; old-activity-masquerading-as-current.

## Never silently truncate

A result the agent can't tell is partial is worse than an error. Every bounded list **declares its
completeness**: a `complete: true|false` marker and a total count (`messages[12 of 12]`,
`channels[5 of 47]`). Pagination over a bounded window runs **to completion** internally, in a stable
documented order, rather than returning page one and stopping. If a hard cap is ever applied, it is
stated in output — never silent.

> Prevents: oldest-first pagination gaps; "no messages on first pass."

## One call returns the complete answer

The most expensive cost is a follow-up call. Favor a single richer response over forcing the agent
into N+1 calls. Concretely: `read` **inlines thread replies** under their parent (don't make the agent
call replies separately); every message carries a **ready-to-use permalink** (don't make the agent
assemble `…/p{ts_without_dot}`); lists carry counts and derived status inline. When in doubt, compute
the thing the agent would obviously need next and include it.

> Prevents: threads-as-a-second-class-call; hand-assembled permalinks; pagination-to-learn-the-count.

## Resolve identity for the agent

Humans and HQ think in names (`#general`); the API needs ids (`C0…`); messages carry user ids, not
names. The agent should never have to pre-resolve. Every channel argument accepts `#name`, bare
`name`, or id interchangeably; user ids in output are resolved to display names. Resolution is
cache-backed so it costs no visible round-trip.

> Prevents: name↔id friction; unreadable raw-id output.

## Stateless, unattended-safe

There is **no daemon, no bridge, no interactive auth step**. Slack's Web API is stateless HTTP, so
each invocation is self-contained. The token resolves from `SLACK_AXI_TOKEN` env or stored config —
never an interactive prompt — so cron jobs, headless runs, and dispatched subagents work the same as
an interactive session. A long-lived user token is stored once; there is no session to expire.

> Prevents: constant logouts; interactive-OAuth breaking headless/scheduled runs; per-subagent tool
> availability caveats (it's just a CLI, available wherever Bash is).

## Read is for windows, search is for finding

Two distinct verbs, never overloaded. `read <channel> --from --to` is the primary verb for sweeping a
time window completely and chronologically. `search` finds a thing across the workspace and makes no
completeness or chronology guarantee. Documentation and `help[]` steer window-sweeps to `read`.

> Prevents: search/read confusion and the unreliable-completeness it caused.

## Writes are safe by default

The agent prepares; a human (or an explicit, separate command) commits. `draft` creates a message for
approval and does **not** send. Direct, unconfirmed posting is not in v1 and, when added, is gated
behind an explicit opt-in. All mutations are idempotent — re-reacting or re-sending a prepared draft
is a no-op at exit 0, never an error.

## Token-frugal, content-first output

Output is TOON, not JSON. Lists default to the smallest useful schema (3–4 fields); `--fields`
expands. Long content is truncated with its full size noted and a `--full` escape hatch. Running with
no arguments shows live state, not a manual. Every list and mutation ends with a few contextual,
fully-formed `help[]` next-step suggestions; self-contained detail views omit them.
