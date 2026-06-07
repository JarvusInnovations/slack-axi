# Command: read (and thread)

The primary verb. Read a channel's messages over a time window, with thread replies inlined, names and
permalinks resolved, paginated to completion. This is the command that fixes the date-window,
completeness, and thread pains.

## Invocations

```
slack-axi read <channel> [--since 7d | --from <when> --to <when>] [--tz <zone>]
                         [--limit N] [--threads full|summary|none]
                         [--exclude-bots] [--fields ...] [--full]
slack-axi thread <channel> <ts>
```

`<channel>` accepts `#name`, bare name, or id (see
[resolution-and-caching.md](../behaviors/resolution-and-caching.md)).

## Data Requirements

- `conversations.history` for the resolved channel over the resolved `[oldest, latest)` window,
  paginated to completion.
- `conversations.replies` for each in-window parent with `reply_count > 0` (per `--threads`).
- User cache for author names; permalink per message.

## Output Rules

Governed by [time-and-completeness.md](../behaviors/time-and-completeness.md),
[threads.md](../behaviors/threads.md), [permalinks.md](../behaviors/permalinks.md), and
[output-format.md](../behaviors/output-format.md). Header carries workspace, channel (name+id+type),
**resolved range with explicit year + tz**, and **`complete` marker**. Messages grouped by Eastern
date; default schema `{time,author,text,ts}`; replies nested `↳`.

The compact `ts` is the stateless citation **handle** (not the full permalink — see
[permalinks.md](../behaviors/permalinks.md)). Permalinks are materialized on demand via
`slack-axi cite <channel> <ts…>`, or inlined up front with `--cite` for bulk-ingest.

```
workspace: Jarvus (T01ABC)
channel: #eng (C0B, private)
range: 2026-05-30 → 2026-06-06 (America/New_York)
complete: true
2026-06-05:
  messages[2 of 12]{time,author,text,ts}:
    09:14,alice,"Shipping the auth fix today",1717589640123456
    09:15,bob,"↳ did the token refresh land?",1717589700234567
2026-06-06:
  messages[1 of 12]{time,author,text,ts}:
    08:02,carol,"Standup moved to 10:30",1717675320345678
help[2]:
  Run `slack-axi thread #eng 1717589640123456` to expand a thread
  Run `slack-axi cite #eng 1717589640123456 …` to get permalinks for messages you cite
```

- Default window: last 7d. Default `--threads full`.
- `complete: false` when the window exceeds `--limit`; response is the most recent N, with a `help[]`
  hint to raise the limit or narrow the window.
- Empty window → definitive empty state naming the channel and resolved range.
- `--cite` (alias `--fields permalink`) inlines permalinks per row for bulk-ingest; `--fields
  user_id,reactions,subtype` adds columns; `--full` returns untruncated text.
- `ts` accepted in commands (`thread`, `cite`, `react`, `draft --reply`) in either dotless
  (`1717589640123456`) or dotted (`1717589640.123456`) form.

## Actions

None (read-only).

## Navigation

`help[]` → `thread` (expand), widen/narrow window, `search` (if looking for a specific thing rather
than a window).

## Principles

**Inherited:**

- [The agent never computes time](../principles.md#the-agent-never-computes-time)
- [Never silently truncate](../principles.md#never-silently-truncate)
- [One call returns the complete answer](../principles.md#one-call-returns-the-complete-answer)
- [Read is for windows, search is for finding](../principles.md#read-is-for-windows-search-is-for-finding)
  — `read` *is* the window verb these principles converge on.
