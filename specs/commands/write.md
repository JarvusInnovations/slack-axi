# Command: write (react, draft, draft send, edit, delete)

The only mutations. Safe by default: reactions, and message **drafts** the user approves — a draft
may be a new post, an **edit** of one of the token's own messages, or a **deletion** of one. No
unconfirmed direct posting, editing, or deleting. See
[principles.md → Writes are safe by default](../principles.md#writes-are-safe-by-default).

## The token's identity

Every write acts as the token's identity: the **user** for a user token (`xoxp-`), the **bot** for a
bot token (`xoxb-`). `auth.test` yields `user_id` for both and `bot_id` for a bot token; both are
stored on the workspace record at login (and resolved lazily, once, for an env-supplied token). A
message is the token's **own** when its `user` equals the identity's `user_id`, or its `bot_id`
equals the identity's `bot_id`. Only own messages can be edited or deleted — there is no override,
even where the token's scopes would technically allow it.

## Subcommands

### `react <channel> <ts> :emoji:`

Adds a reaction (`reactions.write`). Idempotent — already present → `no-op`, exit 0 (see
[errors.md](../behaviors/errors.md)). Returns a confirmation object (no `help[]`).

### `draft <channel> "<text>" [--reply <ts>]`

Creates a **draft** and returns it for approval. Does **not** send. `--reply <ts>` makes it a threaded
draft. The draft is persisted with an id and echoed back in full (the exact text + target) so a human
or the agent can verify before sending.

```
draft:
  id: d_01H…
  workspace: Acme (T01ABC)
  channel: #eng (C0B)
  reply_to: 1717589640.123456
  text: "Confirmed — the refresh landed in 4.8."
help[1]:
  Run `slack-axi draft send d_01H…` to post it
```

### `edit <channel> <ts> "<text>"` / `edit <sent-draft-id> "<text>"`

Prepares an **edit** of one of the token's own messages, as a draft of kind `edit`. Does **not**
change anything in Slack. The target is a channel + `ts` handle (dotless or dotted), or the id of a
draft this tool already sent (its recorded channel + ts are the target — "fix what I just said"
without hunting for the ts).

Before the draft is written, the target message is fetched and the ownership rule above is applied.
A message by anyone else → error `NOT_MESSAGE_AUTHOR`, naming who did post it, exit 1. A ts that
isn't a message in that channel → `MESSAGE_NOT_FOUND`.

The draft echoes the target and both texts so the change can be reviewed:

```
draft: d_7f3a…
kind: edit
workspace: Acme (T01ABC)
channel: #eng (C0B)
target: 1717589640123456
old: "Deploy is green ✅"
new: "Deploy is green ✅ (rolled to all regions)"
help[1]:
  Review it, then apply with `slack-axi draft send d_7f3a…` (or discard with `draft discard d_7f3a…`)
```

### `delete <channel> <ts>` / `delete <sent-draft-id>`

Prepares a **deletion** of one of the token's own messages, as a draft of kind `delete`. Same target
forms and the same ownership check as `edit`; the draft echoes the message text that would be
removed (`old`). Does **not** delete anything until `draft send`.

### `draft send <draft-id>`

The explicit, separate confirmation step that **applies** the draft: `chat.postMessage` for a post,
`chat.update` for an edit, `chat.delete` for a deletion. One confirmation mechanism for every write.
Returns the affected message's ts + permalink (a deletion returns the ts and `deleted: true`).
Idempotent — an already-applied draft acknowledges the prior application, exit 0; deleting a message
that is already gone is reported as a no-op, exit 0. Subject to multi-workspace write-protection (see
[auth-and-workspaces.md](../behaviors/auth-and-workspaces.md)).

`chat.update` replaces the message **text**; an edit's text goes through the same outgoing rendering
as a new post (see [mrkdwn.md](../behaviors/mrkdwn.md) once it lands). Slack's `edit_window_closed`
(workspace policy) surfaces as `EDIT_WINDOW_CLOSED`; `cant_update_message` / `cant_delete_message`
surface as `NOT_MESSAGE_AUTHOR`.

### `draft list` / `draft discard <id>`

List pending drafts; discard one. The list shows each draft's kind (`post`, `edit`, `delete`) and
status. Drafts are stored locally as `~/.config/slack-axi/drafts/<id>.json` (each records its `team`,
so `draft send` acts on the workspace the draft was created against, which also satisfies
multi-workspace write-protection). A draft record carries `kind` (absent means `post`), and for
`edit`/`delete` the `target_ts` and the `previous_text` captured at preparation time. `draft send`
marks the draft `sent` (with the affected ts + permalink) rather than deleting it, so re-sending is an
idempotent no-op.

## Data Requirements

`reactions.add`, `chat.postMessage`, `chat.update`, `chat.delete`; `conversations.history` /
`conversations.replies` to fetch an edit/delete target for the ownership check (a reply's ts is not
returned by `history`, so a miss there is retried via `replies`); `auth.test` once per token to learn
the identity (`user_id`, `bot_id`). `chat:write` covers update/delete of the token's own messages.
Channel/ts resolution per [resolution-and-caching.md](../behaviors/resolution-and-caching.md).

## Output Rules

Per [output-format.md](../behaviors/output-format.md). Mutations return confirmation objects;
`draft`/`edit`/`delete` (prepare) include the `draft send` next-step in `help[]`; `react`/`draft send`
confirmations are self-contained (no `help[]`). An applied edit's confirmation shows the first line of
the new text so the agent can see what landed without a follow-up read.

## Future (not v1)

A `--allow-send` opt-in could collapse draft→send for trusted automation, gated like gws-axi's
write-protection. Out of v1 scope; documented so the draft model is understood as deliberate, not a
limitation to route around.

## Principles

**Inherited:**

- [Writes are safe by default](../principles.md#writes-are-safe-by-default) — the prepare/approve split
  and idempotency are its operationalization.
