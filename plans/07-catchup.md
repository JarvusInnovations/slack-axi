---
status: done
depends: [03-read]
specs:
  - specs/commands/catchup.md
issues: []
---

# 07 — catchup (scoped multi-channel sweep)

## Scope

A "what happened since yesterday" verb: sweep a scoped set of conversations over a window and return
everything posted. Slack has no cross-conversation history endpoint, so this fans out
`conversations.history`; scoping + a call-count guard keep it bounded (never the full 1564).

## Implements

- `specs/commands/catchup.md` — scope resolution (`--in` list, else member channels by `--type`
  default public,private + `--match`), `--max-channels` guard, per-channel sweep with `--limit-per`,
  `--threads` default none, year-stamped range, `swept: N (M active)` summary.

## Approach

- `commands/catchup.ts`: resolve window (reuse `slack/time.ts`), resolve the scoped channel set
  (reuse `getChannels`/`resolveChannel` + fuzzy), enforce the guard, then sweep each channel with
  `fetchWindow` (reuse `slack/threads.ts`), label via `slack/format.ts`. Sequential to respect Slack's
  tightened history rate limits.
- Reuses the ts handle / `--cite` model and the output helpers; no new Slack plumbing.

## Validation

- [x] `catchup` returns per-channel blocks for channels with activity; year-stamped range; `swept: N (M
      active)` summary. *(verified via `--match bid`: swept 29, 8 active.)*
- [x] Scoped set over `--max-channels` → guard error naming the count + how to narrow; no sweep runs.
      *(default member public+private = 515 → `TOO_MANY_CHANNELS`.)*
- [x] `--match`/`--type`/`--in` narrow the set; `--in` accepts a comma list of `#name`/name/id.
      *(verified `--in bid-rtd-analytics,bid-rfta-transitlake`.)*
- [x] Empty channels omitted from the body but counted in `swept`. *(29 swept, 8 shown.)*
- [x] `--limit-per` caps per-channel; exceeding it marks that channel incomplete with its total.
      *(logic in place; per-channel `(most recent N of M…)` header.)*
- [x] Threads not inlined — `[+N replies]` note shown; `--exclude-bots` filters; `--cite` adds permalinks.
- [x] Verified against Jarvus on a real window over the `#bid-*` set (the RTD + RFTA threads).

## Risks / unknowns

- ~~Rate limits~~ → fine in practice: sequential calls + SDK retry; the guard caps the count. A 29-channel
  `--match bid` sweep over 30d returned promptly. (Watch it on much larger scopes.)

## Notes

Verified on Jarvus. The `--max-channels` guard (default 40) is the key safety: an unscoped sweep refuses
to run and tells the agent to narrow. Reuses the read stack (time/threads/format/ts/permalink) wholesale.
Committed to trunk.

## Follow-ups

- **Observed (deferred, low priority):** (1) channel-join / Slackbot **system messages** (`subtype`
  like `channel_join`) show as noise — a future `--exclude-system` or default subtype filter could drop
  them (the HQ workflow discards these). (2) External Slack-Connect users and `<@U…>` mentions of
  uncached users render as raw ids — same fallback noted in plan 03.
