# Behavior: Time windows and completeness

## Rule

The agent never produces or consumes a raw epoch. Commands that read over time accept **human time
in**, resolve it internally, **echo the resolved window back in human form (explicit year + timezone)**,
paginate **to completion** over that window, and emit an explicit **completeness marker**.

## Applies To

`read`, `thread` (window-bounded reads), and any future history-sweeping command. `search` accepts the
same human time flags for its `after:`/`before:` modifiers but makes no completeness guarantee (see
[principles.md → Read is for windows, search is for finding](../principles.md#read-is-for-windows-search-is-for-finding)).

## Details

### Time input

- `--since <span>` — relative span ending now: `90m`, `24h`, `7d`, `30d`. Spans: `m` minutes, `h`
  hours, `d` days.
- `--from <when>` / `--to <when>` — explicit bounds. Accept a date (`2026-04-23`), a datetime
  (`2026-04-23T14:00`), or a relative span (`7d` = 7 days ago). `--to` defaults to now.
- Default window when none given: **last 7 days**.
- Resolution is in **America/New_York (Eastern)** unless `--tz <zone>` is given. Dates without a time
  bind to start/end of day in that zone.
- Internally converted to Slack `oldest`/`latest` (epoch seconds, inclusive `oldest`, exclusive
  `latest`) and passed to `conversations.history` / `conversations.replies`.

### Resolved-range echo (year-correctness guard)

Every windowed read echoes the resolved window in the output header, **with explicit year and tz**:

```
range: 2026-05-30 → 2026-06-06 (America/New_York)
```

This is non-negotiable output (see
[principles.md → The agent never computes time](../principles.md#the-agent-never-computes-time)). It
is the guard against the documented year-wrong-timestamp failure — a 2025/2026 mistake is visible at a
glance instead of silently returning year-old data.

### Pagination to completion

- Walk `conversations.history` cursors until the entire `[oldest, latest)` window is covered — never
  return page one and stop.
- Return messages in **stable chronological order (oldest→newest within each date group)**, regardless
  of the API's native page order. (The API can return oldest-first or newest-first; output order must
  not depend on it.)
- A `--limit N` caps the number of messages returned. If the window contains more than the limit, that
  is reported explicitly (see completeness marker) — never silently dropped.

### Completeness marker

Every windowed read emits, in the header:

- `complete: true` — the full window was returned within the limit.
- `complete: false` — the window held more messages than `--limit`; the response is the most recent
  `N`. The marker is accompanied by the total seen and a `help[]` hint to raise `--limit` or narrow
  the window.

The list count is always `messages[<returned> of <total-in-window>]` so partial results are
unambiguous. See [principles.md → Never silently truncate](../principles.md#never-silently-truncate).

### Date framing

Output groups messages by Eastern date (`2026-06-05:` headers) and stamps each with a human time, so
old-activity-as-current mistakes are obvious. Raw `ts` is retained (for citations / permalinks) but is
not the primary time display. See [permalinks.md](permalinks.md) and
[output-format.md](output-format.md).

## Principles

**Inherited:**

- [The agent never computes time](../principles.md#the-agent-never-computes-time) — this behavior is
  its primary operationalization; the resolved-range echo is the enforcement point.
- [Never silently truncate](../principles.md#never-silently-truncate) — the `complete` marker and
  `<returned> of <total>` count are how this behavior honors it.
