---
status: done
depends: [01-scaffold-auth]
specs:
  - specs/commands/channels.md
  - specs/commands/home.md
  - specs/behaviors/resolution-and-caching.md
issues: []
---

# 02 — Discovery + resolution cache + home

## Scope

Channel/conversation discovery across all types, the identity-resolution cache that backs every other
command, and the content-first home view. This is the layer that fixes the "can't find private
channels / group DMs" pain and makes `#name`/id interchangeable everywhere downstream.

## Implements

- `specs/behaviors/resolution-and-caching.md` — `channels.json`/`users.json` caches, channel
  `#name`/name/id resolution with refresh-on-miss + fuzzy suggestions, user id→name resolution, TTL,
  `cache refresh`.
- `specs/commands/channels.md` — `channels` (default `users.conversations`, all types), `--type`,
  `--all` (`conversations.list` to completion), `dms`, `members`, `search channels`.
- `specs/commands/home.md` — workspace + unread/mention summary + top channels + help[].

## Approach

- `slack/resolve.ts`: cache-backed `resolveChannel(arg)` and `resolveUser(id)`; on channel miss,
  refresh once then fuzzy-match for suggestions.
- Build `channels.json` from `users.conversations` (all types) and merge `conversations.list` results
  the agent touches; always carry name+id+type.
- Home: cheap counts only (no full history); reuse the channels list for "top channels."

## Validation

- [x] `slack-axi channels` returns public + private + mpim + im the user belongs to, without the agent
      specifying `--type`; each row pairs name+id+type; total shown. *(Jarvus: 1564 total — 125 public,
      390 private, 797 mpim, 252 im.)*
- [x] A private channel and a group DM the user is in both appear by default. *(verified.)*
- [x] `slack-axi channels --all` paginates `conversations.list` to completion. *(688 workspace
      public+private vs 515 member; `is_member` column present.)*
- [x] Commands can address a channel by `#name`, bare `name`, or id. *(verified: private `#2one5` →
      `CHVBC6KLH`; id path via `conversations.info` on cache miss.)*
- [x] Channel-name miss refreshes the cache then errors with closest fuzzy matches (not a bare fail).
      *(prefix-scored suggestions: `bid-rtd-xyz-nope` → `#bid-rtd-analytics`, …)*
- [x] `dms` resolves participant names; `members <channel>` resolves member names, paginated.
      *(mpim participants parsed from the channel name — no API calls.)*
- [x] Channel-find ranks member channels first. *(implemented as `channels --match <q>`; member
      channels are the default pool, so they rank first. `search channels` subcommand dropped to avoid
      colliding with plan 04's message `search`.)*
- [x] `slack-axi` no-args home shows workspace + a cache-only channel count + help[]; stays
      token-minimal. *(unread/most-active deferred — see risk below.)*
- [x] `cache refresh` rebuilds caches.

## Risks / unknowns

- ~~Unread/mention counts~~ → **resolved (deferred)**: `users.conversations` returns no unread, and a
  per-channel `conversations.info` fan-out would be 1500+ calls. v1 omits unread entirely and sorts by
  type-group then name; home shows a cache-only channel count instead of an unread summary. Decision
  recorded in `channels.md` / `home.md` ("Deferred in v1"). Revisit if a bulk unread source appears.
- New (managed): a default `channels` would dump 1564 rows (~19k tokens). Added `--limit` (default 50)
  with an explicit `[shown of total]` + raise-`--limit` hint, honoring the no-silent-caps principle.

## Notes

Verified end-to-end against Jarvus (T024GATE8). Discovery now surfaces everything the old MCP couldn't:
390 private channels, 797 group DMs, 252 DMs. Group-DM participants are parsed from the Slack channel
name (`mpdm-…`), so `dms` needs zero per-conversation calls. Committed to trunk.

Notable implementation choices recorded in specs: default `--limit 50` with explicit truncation
(no-silent-caps); unread/most-active sort deferred (no cheap source); channel-find via `--match` rather
than a `search channels` subcommand (avoids colliding with plan 04's message `search`); the resolution
cache (`channels.json`/`users.json`, 1h TTL) backs every downstream command.

## Follow-ups

- **Tracked as:** unread/mention surfacing is deferred to a future plan if a bulk unread source becomes
  available (see Risks). Not blocking any current plan.
