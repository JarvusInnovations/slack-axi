---
status: planned
depends: [02-discovery]
specs:
  - specs/commands/read.md
  - specs/behaviors/time-and-completeness.md
  - specs/behaviors/threads.md
  - specs/behaviors/permalinks.md
issues: []
---

# 03 — read + thread (the core fix)

## Scope

The primary verb. `read <channel>` over a human time window, paginated to completion, with thread
replies inlined, author names resolved, permalinks on every message, and a resolved-range + `complete`
header. Plus `thread <channel> <ts>`. This plan resolves the highest-severity pain cluster (date/window
correctness + threads + permalinks).

## Implements

- `specs/behaviors/time-and-completeness.md` — `slack/time.ts`: span/date parsing, Eastern resolution,
  oldest/latest conversion, resolved-range echo with explicit year+tz; pagination-to-completion; stable
  chronological order; `complete` marker + `<returned> of <total>`.
- `specs/behaviors/threads.md` — `--threads full|summary|none`, replies inlined under parents.
- `specs/behaviors/permalinks.md` — permalink + raw ts per message; HQ-citation field alignment.
- `specs/commands/read.md` — flags, date-grouped output, default 7d/`full`, `--exclude-bots`,
  `--fields`, `--full`; `thread` deep-dive.

## Approach

- `slack/time.ts`: pure functions, unit-tested hard (this is the year-bug guard). Default tz
  America/New_York; `--tz` override.
- `slack/threads.ts`: merge `conversations.history` + per-parent `conversations.replies`, both
  paginated; render nested chronological.
- Permalink: prefer `chat.getPermalink` when cheap; else construct (`p` + ts sans dot, `?thread_ts`).

## Validation

- [ ] `read <channel>` defaults to last 7d, `--threads full`; header echoes resolved range with
      explicit **year** and tz.
- [ ] A window spanning more messages than the API page size returns **all** of them (pagination to
      completion), in stable oldest→newest order regardless of API page order.
- [ ] `complete: true` when fully covered; `complete: false` + most-recent-N + raise-limit hint when
      `--limit` is exceeded; count always `messages[<returned> of <total>]`.
- [ ] Thread replies appear nested under their parent by default; `--threads summary` shows
      reply_count + latest; `--threads none` shows reply_count only.
- [ ] Every message row carries a working permalink; `--fields ts` exposes raw ts.
- [ ] Empty window → definitive empty state naming channel + resolved range; exit 0.
- [ ] `--exclude-bots` filters bot/app messages and the count reflects what was filtered.
- [ ] `thread <channel> <ts>` returns the full thread, names + permalinks resolved.
- [ ] Unit tests: `--since 7d`, `--from/--to` dates, relative spans, year boundaries, tz handling all
      resolve to the correct epoch window.

## Risks / unknowns

- `chat.getPermalink` is one call per message — may be too chatty for wide reads; default to
  constructing the URL and reserve the API call for `thread`/detail. Confirm the constructed format
  matches Slack's (`p<ts_without_dot>`).
- Replies whose parent is in-window but replies fall outside it: spec says include (thread is a unit);
  verify cost is acceptable.

## Notes

(populated at closeout)

## Follow-ups

(populated at closeout)
