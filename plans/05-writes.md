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

- [~] `react <channel> <ts> :emoji:` adds the reaction; re-running (`already_reacted`) is a no-op at
      exit 0. *(code complete + arg validation verified; live reaction not fired — outward-facing,
      awaiting a user-chosen target.)*
- [x] `draft <channel> "<text>"` creates a stored draft and returns it in full **without sending**;
      help[] offers `draft send <id>`. *(verified.)*
- [x] `draft <channel> --reply <ts> "<text>"` records the thread target. *(verified: reply_to stored.)*
- [~] `draft send <id>` posts via `chat.postMessage`, returns permalink + ts; re-running acknowledges
      the prior send (no duplicate), exit 0. *(code complete; not-found path verified; live post not
      fired — outward-facing, awaiting go-ahead. Idempotency via the stored `sent` marker.)*
- [x] `draft list` shows pending drafts; `draft discard <id>` removes one (idempotent). *(verified.)*
- [~] With 2+ workspaces, a mutation requires an explicit team. *(only one workspace is authed, so not
      triggerable; enforced via `activeSession({mutation:true})` → `resolveActiveToken`. `draft send`
      passes the draft's own `team`, satisfying it.)*

## Risks / unknowns

- ~~Draft id scheme + storage~~ → resolved: `d_<8-hex>` ids; global `~/.config/slack-axi/drafts/<id>.json`
  with a `team` field (so send targets the right workspace). Recorded in `write.md`.
- `--allow-send` collapse remains explicitly out of v1 (documented in `write.md`, not built).

## Notes

The non-mutating surface (draft create/list/discard, `--reply`, error paths, arg validation) is verified
on Jarvus. `react` and `draft send` are code-complete but were **not fired at the live workspace** —
they're outward-facing (a visible reaction / a posted message), so live verification awaits a
user-chosen safe target (e.g. a self-DM). `draft send` marks the draft `sent` for idempotency rather
than deleting it. Committed to trunk.

## Follow-ups

- **Live-fire verification (user-gated):** confirm `react` and `draft send` against a target the user
  picks (self-DM or a scratch channel) — the only outstanding check, deliberately not auto-run.
