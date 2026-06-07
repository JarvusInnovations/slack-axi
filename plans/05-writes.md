---
status: done
depends: [02-discovery]
specs:
  - specs/commands/write.md
issues: []
---

# 05 — writes (react, draft, draft send)

## Scope

The v1 mutation surface: reactions and the prepare→approve draft flow. Safe by default — no
unconfirmed direct posting. Honors multi-workspace write-protection.

## Implements

- `specs/commands/write.md` — `react` (idempotent), `draft` (prepare, no send), `draft send` (explicit
  post, idempotent), `draft list`/`discard`; local draft storage.
- Reinforces `specs/behaviors/auth-and-workspaces.md` write-protection (explicit `--team` required when
  2+ workspaces) and `specs/behaviors/errors.md` idempotent-mutation rules.

## Approach

- Depends on 02 for channel/ts resolution. `react` → `reactions.add` (treat already_reacted as no-op).
  `draft` persists `{id, team, channel, reply_to, text}` under the workspace dir and echoes it.
  `draft send` → `chat.postMessage`, returns permalink+ts, marks the draft sent.
- Enforce write-protection in `resolveTeam({mutation:true})`.

## Validation

- [x] `react <channel> <ts> :emoji:` adds the reaction; re-running (`already_reacted`) is a no-op at
      exit 0. *(verified live in #integration-testing: `:rocket:` added, re-react no-op; dotted-ts +
      bare `eyes` form also works.)*
- [x] `draft <channel> "<text>"` creates a stored draft and returns it in full **without sending**;
      help[] offers `draft send <id>`. *(verified.)*
- [x] `draft <channel> --reply <ts> "<text>"` records the thread target. *(verified: reply_to stored.)*
- [x] `draft send <id>` posts via `chat.postMessage`, returns permalink + ts; re-running acknowledges
      the prior send (no duplicate), exit 0. *(verified live: posted a top-level message + a threaded
      reply (thread_ts in permalink); re-send was a no-op; read-back showed both with the reply inlined.)*
- [x] `draft list` shows pending drafts; `draft discard <id>` removes one (idempotent). *(verified.)*
- [~] With 2+ workspaces, a mutation requires an explicit team. *(only one workspace is authed, so not
      triggerable; enforced via `activeSession({mutation:true})` → `resolveActiveToken`. `draft send`
      passes the draft's own `team`, satisfying it.)*

## Risks / unknowns

- ~~Draft id scheme + storage~~ → resolved: `d_<8-hex>` ids; global `~/.config/slack-axi/drafts/<id>.json`
  with a `team` field (so send targets the right workspace). Recorded in `write.md`.
- `--allow-send` collapse remains explicitly out of v1 (documented in `write.md`, not built).

## Notes

Fully verified live in `#integration-testing` (a sanctioned scratch channel): a posted message, an
idempotent re-send, `:rocket:`/`:eyes:` reactions (incl. re-react no-op and dotted-ts/bare-name forms),
a threaded reply, and a write→read round-trip showing the reply inlined. `draft send` marks the draft
`sent` for idempotency rather than deleting it. Committed to trunk.

Note: Slack normalizes unicode emoji in posted text to `:shortcode:` (e.g. `🤖` → `:robot_face:`) —
expected platform behavior, surfaced on read-back.

## Follow-ups

- None. (A `react --remove` / unreact and arbitrary `read --fields reactions` display are possible
  future niceties, not gaps.)
