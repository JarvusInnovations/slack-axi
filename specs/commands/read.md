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
- User cache for author names, with an on-demand `users.info` fallback for external/shared-channel
  authors and mentioned users absent from the bulk roster (all referenced ids hydrated in one batched
  pass before rendering); permalink per message. See
  [resolution-and-caching.md](../behaviors/resolution-and-caching.md).

## Output Rules

Governed by [time-and-completeness.md](../behaviors/time-and-completeness.md),
[threads.md](../behaviors/threads.md), [permalinks.md](../behaviors/permalinks.md), and
[output-format.md](../behaviors/output-format.md). A top-of-output header carries workspace, channel
(label+id+type), **resolved range with explicit year + tz**, a **top-level `messages: <shown> of
<total>`** count, and the **`complete` marker**. Messages are then grouped by Eastern date; default
schema `{time,author,text,ts}`; replies are inlined under their parent prefixed `↳`.

The compact `ts` is the stateless citation **handle** (dotless; not the full permalink — see
[permalinks.md](../behaviors/permalinks.md)). Permalinks are materialized on demand via
`slack-axi cite <channel> <ts…>`, or inlined up front with `--cite` for bulk-ingest.

```
workspace: Acme (T0ABCDEF)
channel: "#eng (C0B, private)"
range: "2026-05-30 09:14 → 2026-06-06 09:15 (America/New_York)"
messages: 3 of 3 top-level (threads inlined below)
complete: true
2026-06-05:
  messages[2]{time,author,text,ts}:
    "09:14",alice,"Shipping the auth fix today",1717589640123456
    "2026-06-06 09:15",bob,"↳ did the token refresh land?",1717589700234567
2026-06-06:
  messages[1]{time,author,text,ts}:
    "08:02",carol,"Standup moved to 10:30",1717675320345678
help[1]:
  Run `slack-axi cite #eng 1717589640123456 <ts...>` for permalinks to messages you cite
```

- Default window: last 7d. Default `--threads full`.
- The headline count is **top-level messages** (`<shown> of <total>`); inlined replies are additional
  rows within the per-date `messages[k]` groups, so a group's row count may exceed the headline.
- A **parent's time** is `HH:MM` (its date is the group header); a **reply's time** is the full
  `YYYY-MM-DD HH:MM`, because a reply can fall on a later day than the parent it's grouped under.
- `complete: false` when the window exceeds `--limit`; response is the most recent N top-level
  messages, with a `help[]` hint to raise the limit or narrow the window.
- Empty window → definitive empty state naming the channel and resolved range; exit 0.
- Message text has Slack markup resolved for readability: `<@U…>` → `@name`, `<#C…|name>` → `#name`,
  `<url|label>` → `label`, `&amp;/&lt;/&gt;` decoded. External (Slack Connect) / guest authors and
  mentions resolve via the `users.info` fallback; an id that genuinely can't be resolved renders
  `Uxxxx (unresolved)` — never a bare id and never a guessed name.
- `--cite` inlines a `permalink` column for bulk-ingest; `--threads full|summary|none`,
  `--exclude-bots` (count reported as `bot_filtered`), `--tz <zone>`, `--full` (untruncated text).
- `ts` is accepted by `thread`/`cite` (and later `react`/`draft --reply`) in either dotless
  (`1717589640123456`) or dotted (`1717589640.123456`) form.
- **Reactions, inline (counts only):** when any message in the view has a reaction, a `reactions`
  column is added (uniform across rows, empty for messages with none) showing a compact counts-only
  summary `:heart:×12 :eyes:×3`. This rides on the history/replies call already being made — no extra
  request. The reactor *names* are not shown inline (the embedded roster is truncated); a `help[]`
  pointer steers to `reactions <channel> <ts>` for the complete, identity-resolved roster. See
  [reactions.md](../behaviors/reactions.md). `thread` carries the same inline column.
- **Files, inline:** when any message in the view has an attachment, a `files` column is added (uniform
  across rows, empty for messages with none) listing each file as `name (filetype, size) [F-id]`. This
  rides on the history/replies payload already fetched — no extra call and no `files:read` scope to
  *see* the attachment. The `F-id` is the handle for `slack-axi download <file-id…>`, which fetches the
  bytes to a local path. An inaccessible/tombstoned file is shown as `(unavailable) [F-id]`. See
  [files.md](../behaviors/files.md). `thread` carries the same column.

## Actions

None (read-only).

## Navigation

`help[]` → `thread` (expand), `reactions <channel> <ts>` (who reacted, when the view shows reactions),
widen/narrow window, `search` (if looking for a specific thing rather than a window).

## Principles

**Inherited:**

- [The agent never computes time](../principles.md#the-agent-never-computes-time)
- [Never silently truncate](../principles.md#never-silently-truncate)
- [One call returns the complete answer](../principles.md#one-call-returns-the-complete-answer)
- [Read is for windows, search is for finding](../principles.md#read-is-for-windows-search-is-for-finding)
  — `read` *is* the window verb these principles converge on.
