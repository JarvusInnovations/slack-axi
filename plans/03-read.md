---
status: planned
depends: [02-discovery]
specs:
  - specs/commands/read.md
  - specs/commands/cite.md
  - specs/behaviors/time-and-completeness.md
  - specs/behaviors/threads.md
  - specs/behaviors/permalinks.md
issues: []
---

# 03 — read + thread + cite (the core fix)

## Scope

The primary verb. `read <channel>` over a human time window, paginated to completion, with thread
replies inlined, author names resolved, a compact `ts` citation handle per message, and a
resolved-range + `complete` header. Plus `thread <channel> <ts>` and the stateless `cite <channel>
<ts…>` that reconstructs permalinks on demand. This plan resolves the highest-severity pain cluster
(date/window correctness + threads + citations).

## Implements

- `specs/behaviors/time-and-completeness.md` — `slack/time.ts`: span/date parsing, Eastern resolution,
  oldest/latest conversion, resolved-range echo with explicit year+tz; pagination-to-completion; stable
  chronological order; `complete` marker + `<returned> of <total>`.
- `specs/behaviors/threads.md` — `--threads full|summary|none`, replies inlined under parents.
- `specs/behaviors/permalinks.md` — `ts` handle per row (default), permalink on demand, HQ-citation
  field alignment.
- `specs/commands/read.md` — flags, date-grouped output, default 7d/`full`, `--exclude-bots`,
  `--cite`/`--fields`, `--full`; dotless/dotted `ts` accepted; `thread` deep-dive.
- `specs/commands/cite.md` — stateless `cite <channel> <ts…>` → permalinks + HQ `slack_message` shape.

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
- [ ] Every message row carries a compact `ts` handle by default (not the full permalink); `--cite`
      inlines permalinks per row.
- [ ] `cite <channel> <ts…>` reconstructs correct permalinks (with `?thread_ts=` for replies) from
      handles alone, statelessly, and emits the HQ `{channel, ts, permalink}` source shape; dotless and
      dotted `ts` both accepted.
- [ ] Empty window → definitive empty state naming channel + resolved range; exit 0.
- [ ] `--exclude-bots` filters bot/app messages and the count reflects what was filtered.
- [ ] `thread <channel> <ts>` returns the full thread, names + permalinks resolved.
- [ ] Unit tests: `--since 7d`, `--from/--to` dates, relative spans, year boundaries, tz handling all
      resolve to the correct epoch window.

## Risks / unknowns

- Permalink chattiness is largely sidestepped: rows carry only the `ts` handle by default, and `cite`
  constructs URLs locally (no per-message `chat.getPermalink`). Still confirm the constructed format
  matches Slack's (`p<ts_without_dot>`, `?thread_ts=` for replies) against a real workspace.
- Replies whose parent is in-window but replies fall outside it: spec says include (thread is a unit);
  verify cost is acceptable.

## Notes

(populated at closeout)

## Follow-ups

(populated at closeout)
