---
status: in-progress
depends: [05-writes]
specs:
  - specs/commands/write.md
  - specs/behaviors/errors.md
  - specs/behaviors/auth-and-workspaces.md
  - specs/architecture.md
issues: [20]
---

# 14 — edit and delete the token's own messages, through the draft/approve shape

## Scope

Let a bot (or a person) change or remove a message after `draft send`: an `edit` that prepares a
`chat.update`, a `delete` that prepares a `chat.delete`, both applied by the existing `draft send`
confirmation so there is one approval mechanism for every write. Ownership is checked at preparation
time against the token's identity (`user_id` for a user token, `bot_id` for a bot token).

**In:** `edit <channel> <ts> "<text>"` / `edit <sent-draft-id> "<text>"`; `delete <channel> <ts>` /
`delete <sent-draft-id>`; draft record `kind` (`post`|`edit`|`delete`), `target_ts`, `previous_text`;
`draft send` dispatch by kind; `draft list` shows kind; identity (`bot_id`) captured at login and
resolved lazily for env tokens; new errors `NOT_MESSAGE_AUTHOR`, `EDIT_WINDOW_CLOSED`; idempotent
delete of an already-gone message.

**Out:** Markdown → mrkdwn/Block Kit rendering of the edit text (plan 15 / #19 — `edit` will call
the same outgoing renderer as `draft` once it exists; until then text is sent verbatim, as `draft`
does today); editing messages posted with Block Kit `blocks` (plan 15 defines how a bot-mode edit
resends blocks); a `--force` to touch others' messages (never).

## Implements

- `specs/commands/write.md` — identity section; `edit`/`delete` subcommands; `draft send` applies by
  kind; `draft list` kinds; data requirements; output rules.
- `specs/behaviors/errors.md` — `NOT_MESSAGE_AUTHOR`, `EDIT_WINDOW_CLOSED`; already-gone delete no-op.
- `specs/behaviors/auth-and-workspaces.md` — write-protection covers edit/delete sends; identity
  (`bot_id`) on the workspace record; bot tokens accepted.
- `specs/architecture.md` — `token.json` carries `bot_id?`.

## Approach

1. **Identity.** `TokenIdentity` (`slack/client.ts`) gains `botId?` from `auth.test`'s `bot_id`;
   `StoredToken`/`ActiveToken` (`config.ts`) gain `bot_id`/`botId`; `auth login` stores it; `Session`
   gains `botId?` and an `ensureIdentity(session)` helper that runs `auth.test` once when `userId` is
   unknown (env token with no stored record).
2. **Target lookup.** `fetchMessage(session, channelId, ts)` in `slack/threads.ts`: `history` with
   `latest = oldest = ts, inclusive, limit 1`; on a miss (replies aren't in history) try `replies` with
   `ts` and match the exact ts. Returns `Msg | undefined`.
3. **Ownership.** Pure `isOwnMessage(msg, identity)` in `commands/write.ts`: `msg.user === userId ||
   (botId && msg.botId === botId)`. Not own → `NOT_MESSAGE_AUTHOR` naming the author (resolved name).
4. **Draft record.** `Draft` gains `kind?`, `target_ts?`, `previous_text?`. `editCommand`/`deleteCommand`
   resolve the target (channel+ts or a sent draft's recorded channel+ts), fetch, check, write the draft,
   echo `old`/`new`. `draftSend` dispatches: post → `chat.postMessage`; edit → `chat.update`; delete →
   `chat.delete` (Slack `message_not_found` → already-gone no-op). `draftList` status shows the kind.
5. **Errors.** `slack/errors.ts`: `cant_update_message`/`cant_delete_message` → `NOT_MESSAGE_AUTHOR`;
   `edit_window_closed` → `EDIT_WINDOW_CLOSED`.
6. **CLI.** Register `edit` and `delete`; `TOP_HELP`; README + skill.
7. **Tests** (`test/write.test.ts`): `isOwnMessage` matrix (user match, bot match, neither, missing
   identity); `edit`/`delete` usage errors with no network; `draftStatus` labels; `fetchMessage`
   fallback to replies via a fake client.

## Validation

- [ ] `edit <channel> <ts> "<text>"` on my own message prepares a `kind: edit` draft showing `old`/`new`;
      `draft send` applies it and the message text changes in Slack; the confirmation carries ts +
      permalink + first line of the new text. (Live.)
- [ ] `edit <sent-draft-id> "<text>"` targets the message that draft posted. (Live.)
- [ ] `edit`/`delete` on someone else's message → `NOT_MESSAGE_AUTHOR` naming the author, exit 1, no
      draft written. (Live.)
- [ ] `delete <channel> <ts>` on my own message prepares a `kind: delete` draft; `draft send` removes
      it; a second `draft send` is a no-op; preparing + sending another delete of the same ts reports
      already-gone no-op, exit 0. (Live.)
- [ ] A thread reply can be targeted (lookup falls through to `replies`). (Live.)
- [ ] `draft list` shows `edit (pending)` / `delete (pending)` / `sent` kinds.
- [ ] Multi-workspace write-protection gates `draft send` of edit/delete drafts exactly as for posts.
- [ ] `bun run test`, `typecheck`, `lint`, `format:check` clean.

## Risks / unknowns

- **Reply lookup** — `conversations.replies` with a reply's ts returns that reply (not the whole
  thread) in practice; if a workspace returns the full thread instead, the exact-ts match still finds
  it. Covered by the fake-client test and a live thread-reply check.
- **Bot tokens through a user-token tool** — `doctor` will flag scope gaps for an `xoxb` token; that is
  expected and documented. Ownership keyed to `bot_id` is what makes bot-mode edits work.
- **Rendering of edits** lands in plan 15; until then an edit sends text verbatim like `draft` does.

## Notes

(At closeout.)

## Follow-ups

(At closeout.)
