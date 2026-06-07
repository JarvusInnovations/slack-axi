---
status: planned
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

- [ ] `slack-axi channels` returns public + private + mpim + im the user belongs to, without the agent
      specifying `--type`; each row pairs name+id+type; total shown (`channels[N of M]`).
- [ ] A private channel and a group DM the user is in both appear by default.
- [ ] `slack-axi channels --all` paginates `conversations.list` to completion.
- [ ] `read`/other commands can address a channel by `#name`, bare `name`, or id (resolution unit
      verified here even if `read` lands in plan 03).
- [ ] Channel-name miss refreshes the cache then errors with closest fuzzy matches (not a bare fail).
- [ ] `dms` resolves participant names; `members <channel>` resolves member names, paginated.
- [ ] `search channels <q>` ranks member channels first.
- [ ] `slack-axi` no-args home shows workspace, unread/mention count, top channels, help[]; stays
      token-minimal.
- [ ] `cache refresh` rebuilds caches.

## Risks / unknowns

- Unread/mention counts: `users.conversations` doesn't return unreads directly; may need
  `conversations.info` per channel or accept an approximate/omitted unread in v1 — decide during impl,
  prefer omitting over an expensive fan-out if costly. Log the decision back into home.md.

## Notes

(populated at closeout)

## Follow-ups

(populated at closeout)
