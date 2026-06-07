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
date; default schema `{time,author,text,permalink}`; replies nested `↳`.

```
workspace: Jarvus (T01ABC)
channel: #eng (C0B, private)
range: 2026-05-30 → 2026-06-06 (America/New_York)
complete: true
2026-06-05:
  messages[2 of 12]{time,author,text,permalink}:
    09:14,alice,"Shipping the auth fix today",https://jarvus.slack.com/archives/C0B/p1717589640123456
    09:15,bob,"↳ did the token refresh land?",https://jarvus.slack.com/archives/C0B/p1717589700234567
2026-06-06:
  messages[1 of 12]{time,author,text,permalink}:
    08:02,carol,"Standup moved to 10:30",https://jarvus.slack.com/archives/C0B/p1717675320345678
help[2]:
  Run `slack-axi thread #eng 1717589640.123456` to expand a thread
  Widen with `--since 30d` or `--from <date>`
```

- Default window: last 7d. Default `--threads full`.
- `complete: false` when the window exceeds `--limit`; response is the most recent N, with a `help[]`
  hint to raise the limit or narrow the window.
- Empty window → definitive empty state naming the channel and resolved range.
- `--fields ts,user_id,reactions,subtype` adds columns; `--full` returns untruncated text.

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
