---
status: done
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

- [x] `read <channel>` defaults to last 7d, `--threads full`; header echoes resolved range with
      explicit **year** and tz. *(verified on `#general`.)*
- [x] A window spanning more messages than the API page size returns **all** of them (pagination to
      completion), in stable oldest→newest order regardless of API page order. *(cursor loop in
      `fetchWindow`; sorted ascending.)*
- [x] `complete: true` when fully covered; `complete: false` + most-recent-N + raise-limit hint when
      `--limit` is exceeded; header carries top-level `messages: <returned> of <total>`.
- [x] Thread replies appear nested under their parent by default; `--threads summary` shows
      reply_count + a `thread` hint; `--threads none` omits them. *(verified.)*
- [x] Every message row carries a compact dotless `ts` handle by default (not the full permalink);
      `--cite` inlines permalinks per row. *(verified.)*
- [x] `cite <channel> <ts…>` reconstructs correct permalinks (with `?thread_ts=` for replies) from
      handles alone, statelessly, emits the HQ `{channel, ts, permalink}` shape; dotless+dotted `ts`
      accepted; bad ts → per-row error, not a command failure. *(verified.)*
- [x] Empty window → definitive empty state naming channel + resolved range; exit 0. *(verified.)*
- [x] `--exclude-bots` filters bot/app messages and the count reflects what was filtered
      (`bot_filtered`). *(verified.)*
- [x] `thread <channel> <ts>` returns the full thread, names + permalinks resolved. *(verified.)*
- [x] Unit tests: `--since 7d`, `--from/--to` dates, relative spans, **year boundaries**, tz handling
      resolve to the correct epoch window. *(11 vitest cases pass, incl. EDT/EST + 2025/2026 guard.)*

## Risks / unknowns

- ~~Permalink construction~~ → **resolved**: used `chat.getPermalink` (robust; handles `thread_ts` and
  the workspace subdomain) rather than hand-constructing — materialized only on `cite`/`--cite`, so the
  default `read` path makes zero permalink calls. Verified the URLs against Acme.
- ~~Replies outside the window~~ → **resolved**: a thread is fetched whole when its parent is in-window;
  cost is fine. Reply rows show a full `YYYY-MM-DD HH:MM` so cross-day replies aren't mistaken for the
  parent's date.

## Notes

Verified end-to-end against Acme on `#general` — a proposal-loss thread that
was the documented near-miss (an internal session). It now reads with year-stamped dates, inlined
threads, completeness marker, and working permalinks. Message markup (`<@U>`/`<#C|name>`/`<url|label>`)
is resolved for readability. Time logic is pure + unit-tested (`src/slack/time.ts`, the year-bug
guard). Committed to trunk.

## Follow-ups

- **None blocking.** Observed: external Slack-Connect users (not in `users.list`) render as raw ids —
  acceptable graceful fallback; revisit if name resolution for external users becomes important.
