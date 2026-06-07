---
status: planned
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

- [ ] `react <channel> <ts> :emoji:` adds the reaction; re-running is a no-op at exit 0.
- [ ] `draft <channel> "<text>"` creates a stored draft and returns it in full **without sending**;
      help[] offers `draft send <id>`.
- [ ] `draft <channel> --reply <ts> "<text>"` records the thread target.
- [ ] `draft send <id>` posts via `chat.postMessage`, returns the posted permalink + ts; re-running
      acknowledges the prior send (no duplicate post), exit 0.
- [ ] `draft list` shows pending drafts; `draft discard <id>` removes one.
- [ ] With 2+ workspaces stored, a mutation without `--team`/`SLACK_AXI_TEAM` errors (write-protection),
      while reads still fall back to default.

## Risks / unknowns

- Draft id scheme + storage location (per-workspace file vs. single store) — pick during impl; ensure
  ids are stable and human-quotable.
- `--allow-send` collapse is explicitly out of v1; don't build it, just leave the design note.

## Notes

(populated at closeout)

## Follow-ups

(populated at closeout)
