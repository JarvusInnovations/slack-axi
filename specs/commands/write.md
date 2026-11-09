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

### `draft <channel> ["<text>"] [--reply <ts>] [--file <path>]… [--snippet <path>]… [--raw] [--preview]`

Creates a **draft** and returns it for approval. Does **not** send. `--reply <ts>` makes it a threaded
draft. `--file <path>` attaches a local file and `--snippet <path>` attaches a local text file as a
snippet; both repeat, and the text may be omitted when an attachment is given. Attaching uploads
nothing until `draft send` — see [files.md → Uploading](../behaviors/files.md#uploading-requires-fileswrite). The text is **Markdown** and is rendered at preparation time into the workspace mode's Slack
dialect — mrkdwn text in human mode, Block Kit in bot mode — per
[mrkdwn.md](../behaviors/mrkdwn.md). `--raw` skips rendering (text sent verbatim); `--preview` prints
the rendering and writes nothing. The draft is persisted with an id and echoed back in full (the
rendering + target) so a human or the agent can verify exactly what will be sent.

```
draft: d_01H…
mode: human
workspace: Acme (T01ABC)
channel: #eng (C0B)
reply_to: 1717589640123456
text: "Confirmed — the refresh landed in *4.8*."
help[1]:
  Review it, then post with `slack-axi draft send d_01H…` (or discard with `draft discard d_01H…`)
```

In bot mode the echo shows `blocks: 7 in 1 chunk(s)` with each chunk's block types and the `text`
fallback instead of the rendered text.

A draft with attachments adds an `attachments` list (also under `--preview`):

```
attachments[2]{name,kind,size,path}:
  error.png,file,158KB,/home/me/shots/error.png
  query.sql,snippet (sql),2KB,/home/me/work/query.sql
```

### `edit <channel> <ts> "<text>" [--raw] [--preview]` / `edit <sent-draft-id> "<text>"`

Prepares an **edit** of one of the token's own messages, as a draft of kind `edit`. Does **not**
change anything in Slack. The target is a channel + `ts` handle (dotless or dotted), or the id of a
draft this tool already sent (its recorded channel + ts are the target — "fix what I just said"
without hunting for the ts). The new text is Markdown and is rendered exactly as `draft` renders
(`--raw`/`--preview` behave the same); a bot-mode edit whose rendering needs more than one chunk is
refused with `TOO_LONG_FOR_EDIT`. `--file`/`--snippet` are refused with `USAGE`: Slack cannot change
a message's files in an edit.

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
removed (`old`). Targeting a sent attachment post by its draft id also deletes the files that draft
uploaded (the echo lists them under `also_deletes_files`); targeting by `<channel> <ts>` removes the
message only. Does **not** delete anything until `draft send`.

### `draft send <draft-id>`

The explicit, separate confirmation step that **applies** the draft: `chat.postMessage` for a post,
`chat.update` for an edit, `chat.delete` for a deletion. One confirmation mechanism for every write.
Returns the affected message's ts + permalink (a deletion returns the ts and `deleted: true`).
Idempotent — an already-applied draft acknowledges the prior application, exit 0; deleting a message
that is already gone is reported as a no-op, exit 0. Subject to multi-workspace write-protection (see
[auth-and-workspaces.md](../behaviors/auth-and-workspaces.md)).

A post with attachments is sent by uploading the files and sharing them with the message in one
step; the reviewed bytes are checked first (`ATTACHMENT_CHANGED` if a file changed or vanished since
the draft). The confirmation adds `files` (the uploaded ids). If Slack has not yet reported the shared
message, `ts` is `pending` — see [files.md → Uploading](../behaviors/files.md#uploading-requires-fileswrite).

A post in bot mode may span several messages (one per chunk — see
[mrkdwn.md](../behaviors/mrkdwn.md)); the confirmation lists every ts, and the draft records them all.
Targeting such a post by its draft id: `delete` removes **every** chunk (the draft echo lists the
additional ts under `also_removes`); `edit` is refused with `MULTI_CHUNK_POST`, since one `chat.update`
can replace only one message — delete and re-post, or edit a single chunk by `<channel> <ts>`.
`chat.update` replaces the message's `text` (and `blocks`) wholesale with the edit's rendering. Slack's
`edit_window_closed` (workspace policy) surfaces as `EDIT_WINDOW_CLOSED`; `cant_update_message` /
`cant_delete_message` surface as `NOT_MESSAGE_AUTHOR`.

### `draft list [--all]` / `draft discard <id>`

List drafts; discard one. By default `draft list` shows only **pending** drafts (not yet sent or
applied) — the ones an agent can still act on — with a header that states both counts
(`drafts[2 pending of 46]`) so the filtered view is never mistaken for the whole history; `--all`
includes sent and applied drafts. With nothing pending, the empty state says how many were already
sent and points at `--all`. The list shows each draft's kind (`post`, `edit`, `delete`) and status. Drafts are stored locally as `~/.config/slack-axi/drafts/<id>.json` (each records its `team`,
so `draft send` acts on the workspace the draft was created against, which also satisfies
multi-workspace write-protection). A draft record carries `kind` (absent means `post`), the Markdown
`markdown` source and its rendering (`text`, plus `blocks` in bot mode, or `raw: true`), any
`attachments` (absolute path, name, size, SHA-256, and snippet type for snippets; the uploaded file ids
are added under `sent.files` once sent), and for
`edit`/`delete` the `target_ts` and the `previous_text` captured at preparation time. `draft send`
marks the draft `sent` (with the affected ts + permalink) rather than deleting it, so re-sending is an
idempotent no-op.

## Data Requirements

`reactions.add`, `chat.postMessage`, `chat.update`, `chat.delete`; for attachments
`files.getUploadURLExternal` + `files.completeUploadExternal` (scope `files:write`), `files.info` to
find the shared message, and `files.delete` when a draft-id delete removes its uploads; `conversations.history` /
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
