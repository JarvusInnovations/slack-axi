# Command: catchup

Sweep a **scoped set** of conversations over a time window and return everything posted in it — a
multi-channel `read`. This is the "what happened since yesterday morning" verb. Because Slack has no
cross-conversation history endpoint, `catchup` fans out `conversations.history` over the matching
channels; the scope and a call-count guard keep that fan-out bounded.

## Invocation

```
slack-axi catchup [--since 1d | --from <when> --to <when>] [--tz <zone>] [--every <span>]
                  [--type public,private,mpim,im] [--match <q>] [--in <c1,c2,...>]
                  [--limit-per <n>] [--max-channels <n>] [--exclude-bots] [--cite]
```

## Plan mode (`--every <span>`)

For a big catch-up (a month+), `--every` turns catchup into a **planner**: it emits the ordered,
year-stamped batch windows and the per-batch command — and fetches **nothing** (no
`conversations.history` calls). The agent then runs each batch in order (`catchup --from <from> --to
<to> <scope>`), processing one window at a time so per-batch output stays bounded and the work is
checkpointable. The emitted per-batch command echoes the scope flags (`--type`/`--match`/`--in`,
`--exclude-bots`) so each batch keeps the same scope.

Batches tile the window as half-open `[from, to)` ranges that share a boundary instant: **no gap, no
overlap** (see [time-and-completeness.md](../behaviors/time-and-completeness.md)). Displayed as
non-overlapping inclusive date ranges (batch 1 `…→ 05-07`, batch 2 `05-08 →…`); the final batch is
clipped to `--to`. Batches advance by a fixed span from the window start, so a DST transition shifts a
boundary's wall-clock by an hour — coverage stays exact; only a displayed date may nudge.

## Data Requirements

- The conversation set, then `conversations.history` per channel over the resolved window (paginated to
  completion), plus the user cache for names — with the on-demand `users.info` fallback for
  external/shared-channel authors and mentions absent from the bulk roster (all referenced ids across
  the swept channels hydrated in one batched pass; unresolvable ids render `Uxxxx (unresolved)`). See
  [resolution-and-caching.md](../behaviors/resolution-and-caching.md). Threads via
  `conversations.replies` only when `--threads full`.
- **Scope resolution:**
  - `--in <c1,c2,...>` — an explicit comma-separated channel list (`#name`/name/id each).
  - else member channels (`is_member`) filtered by `--type` (default `public,private` — DMs/group DMs
    are excluded unless `--type` names them) and `--match` (fuzzy name).

## Display Rules

- **Call-count guard (no blind fan-out):** if the scoped set exceeds `--max-channels` (default 40),
  `catchup` does **not** run — it returns an error stating how many channels matched and how to narrow
  (`--match`/`--type`/`--in`) or raise `--max-channels`. The cost is always surfaced before the sweep.
- Channels are swept; those with **zero** messages in the window are omitted from the body but counted.
- Output header: workspace, resolved range (explicit year + tz), and a `swept: N channels (M with
  activity)` summary.
- Per active channel: a labeled block with the channel (name+id) and its messages — default schema
  `{time,author,text,ts}`, `time` a full `YYYY-MM-DD HH:MM` (a window can cross days). Governed by
  [permalinks.md](../behaviors/permalinks.md) (ts handle; `--cite`/`cite` for permalinks) and
  [time-and-completeness.md](../behaviors/time-and-completeness.md).
- **Threads are not inlined** (kept cheap across many channels): a `[+N replies]` note marks a message
  with a thread, and `help[]` points to `read <channel>` / `thread <channel> <ts>` to expand one.
- `--limit-per <n>` (default 50) caps messages **per channel**; when exceeded, that channel's block is
  marked incomplete with its total — never a silent per-channel cap.

## Principles

**Inherited:**

- [The agent never computes time](../principles.md#the-agent-never-computes-time) — same window
  resolution + year-stamped echo as `read`.
- [Never silently truncate](../principles.md#never-silently-truncate) — the call-count guard, the
  `swept: N (M active)` summary, and per-channel `of <total>` counts keep both the fan-out scope and any
  per-channel cap explicit.
- [Read is for windows, search is for finding](../principles.md#read-is-for-windows-search-is-for-finding)
  — `catchup` is the windowed sweep across many channels; `search` remains for finding a thing.
