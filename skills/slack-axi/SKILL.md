---
name: slack-axi
description: Read, search, cite, and draft Slack from the shell. Use when asked to read or summarize a Slack channel, find a discussion across Slack, look up private channels / group DMs / DMs, read a channel over a date range, follow a thread, produce permalink citations, view or download a file or code snippet shared in Slack, or draft a message (optionally with attached files or snippets) for approval before posting. Token-efficient TOON output; human date ranges in, permalinks out.
---

# slack-axi

A CLI for reading, searching, and citing Slack with agent-ergonomic (TOON) output. Replaces the
flaky Slack MCP: a stored user token (no logouts, works headless), all conversation types discoverable,
human date windows (no epoch math), threads inlined, and permalinks on demand.

Run commands with `npx -y slack-axi <command>` (or `slack-axi` if installed on PATH). Channel
arguments accept `#name`, bare `name`, or an id (`C…`/`G…`/`D…`) interchangeably.

## Orient

- `npx -y slack-axi` — home: active workspace + your channel count.
- `npx -y slack-axi doctor` — verify the token works and scopes are covered.

## Find channels (incl. private channels, group DMs, DMs)

- `npx -y slack-axi channels` — your conversations across ALL types (capped; use `--match`/`--type`).
- `npx -y slack-axi channels --match proj` — fuzzy-find by name.
- `npx -y slack-axi channels --type private` — filter (public|private|mpim|im); `--all` for the whole workspace.
- `npx -y slack-axi dms` — DMs and group DMs with participants.
- `npx -y slack-axi members <channel>` — channel members; external/shared-channel and guest names resolved on demand, unresolvable ids shown as `Uxxxx (unresolved)`.
- `npx -y slack-axi user <id|@handle> [...]` — look up users by id or handle: real/display name and whether each is external (Slack Connect), a guest, or a bot. Resolves shared-channel members the roster misses.

## Read a channel over a time window (the primary verb)

- `npx -y slack-axi read <channel>` — last 7 days, thread replies inlined, names resolved.
- `npx -y slack-axi read <channel> --from 2026-04-23 --to 2026-04-29` — explicit window (human dates).
- `npx -y slack-axi read <channel> --since 24h` — relative span (`90m`, `24h`, `7d`).
- Flags: `--threads full|summary|none`, `--limit <n>`, `--exclude-bots`, `--tz <zone>`, `--cite`, `--full`.
- The output header echoes the resolved range **with explicit year + timezone** (sanity-check the year),
  a `complete: true|false` marker, and a top-level `messages: N of M` count — coverage is never silently
  partial.
- `npx -y slack-axi thread <channel> <ts>` — read one thread fully.
- `read`/`thread` show a counts-only `reactions` column (`:emoji:×N`) when any message in view has
  reactions — free, already in the data. For **who** reacted, use the `reactions` command below.
- `read`/`thread` also show a `files` column when a message has attachments — `name (type, size) [F-id]`,
  free from the same payload. Use the `F-id` with `download` to fetch the bytes. A snippet shows as
  `q.sql (snippet: sql, 42 lines) [F-id]`; read its text with `file <F-id>`.
- `read`/`thread` show a `links` column when a message carries a link unfurl — `title <url>`, URL always
  whole. URLs in message text are never cut by truncation, and `<url|label>` links render as
  `label (url)` so the href is always recoverable.
- When any text was truncated, `help[]` says so and names `--full`; if you see the hint and need the
  full text, re-run with `--full` (also on `catchup`).

## Files / attachments

- `npx -y slack-axi download <file-id…> [--out <dir>]` — fetch one or more attachments (file ids from a
  `read`/`thread` files column) to local files; prints the saved absolute paths so you can open them
  (e.g. to view a screenshot). Read-only against Slack; needs the `files:read` scope. Downloading is
  explicit — reading a thread lists attachments but never fetches their bytes on its own.
- `npx -y slack-axi file <file-id…> [--full]` — print a snippet's or text file's text inline (first 200
  lines; `shown: N of M lines` says if it was cut; `--full` for all). Binary files show metadata only and
  point at `download`. Needs `files:read`.

## Reactions (who reacted)

- `npx -y slack-axi reactions <channel> <ts>` — every emoji on a message + the complete, name-resolved
  roster of who reacted (count-desc). Sourced from `reactions.get full=true` (the only complete source;
  the inline counts come truncated-roster-free from history). Pass a `ts` handle from a `read`/`search`
  row.

## Search (find a thing — NOT a window sweep)

- `npx -y slack-axi search "<query>"` — across the workspace.
- The query is **optional** when a filter narrows the search: `search --in #eng --from alice --after
  2026-05-01` sweeps by filter alone (no free-text term needed).
- Modifiers: `--in <channel>`, `--from <@user>` (sender), `--with <@user>` (conversations including a
  person), `--after <date|span>`, `--before <date|span>`, `--limit <n>`, `--cite`.
- To read a channel over a window completely, use `read --from --to`, not `search`.

## Cite (permalinks for the messages you reference)

Read/search rows carry a compact `ts` handle, not a full permalink. To turn handles into permalinks:

- `npx -y slack-axi cite <channel> <ts> [<ts> ...]` — reconstructs permalinks (with `thread_ts` for
  replies) and emits `{channel, ts, permalink}` per message — ready to drop into a citation record.
- Or pass `--cite` to `read`/`search` to inline permalinks up front (for bulk ingestion).

## Setup (once per workspace)

- `npx -y slack-axi auth setup` — generates an app manifest (all scopes pre-filled, token rotation off)
  and walks you through creating + installing a Slack app, then `auth login --token xoxp-…`.
- After an upgrade that adds a required scope, `doctor` and `auth setup` name the missing scope. The fix
  is a human step: add the scope under the app's OAuth & Permissions → User Token Scopes, then click
  Reinstall to Workspace. The token stays the same, so don't ask for a new one or re-run `auth login`.
- `npx -y slack-axi setup hooks` — install a SessionStart hook so each agent session starts with the
  slack-axi home view as ambient context.

## Write (react, draft, edit, delete — nothing happens without `draft send`)

- `npx -y slack-axi react <channel> <ts> :emoji:` — add a reaction (idempotent).
- `npx -y slack-axi draft <channel> "<text>" [--reply <ts>]` — prepare a message; it is NOT sent.
  Review the echoed draft, then `npx -y slack-axi draft send <id>` posts it.
- Attach local files with `--file <path>` and code/text as a snippet with `--snippet <path>` (syntax type
  from the extension); both repeat, up to 10, and the text becomes optional. Nothing uploads until
  `draft send`, and the send refuses (`ATTACHMENT_CHANGED`) if a file changed since the draft. For
  inline code you don't have on disk, write it to a scratch file first. `edit` can't change attachments;
  `delete <sent-draft-id>` removes the message and the files it uploaded. Needs `files:write`.
- **Write Markdown.** It is rendered for the workspace mode (`npx -y slack-axi auth mode` shows/sets it):
  `human` (user token) → mrkdwn text; `bot` (bot token) → Block Kit, chunked. `**bold**` → `*bold*`, a
  single `*x*` is italic, `# H` → bold line, `- x` → `• x`, `[t](u)` → `<u|t>`. Hand-written `<@U…>`,
  `<url|label>`, `•` pass through. `--raw` skips rendering; `--preview` shows the rendering, saves nothing.
- `npx -y slack-axi edit <channel> <ts> "<new markdown>"` or `edit <sent-draft-id> "<new markdown>"` — prepare an
  edit of a message **this token posted**; the draft shows old → new. `draft send <id>` applies it.
- `npx -y slack-axi delete <channel> <ts>` or `delete <sent-draft-id>` — prepare deletion of a message
  this token posted; `draft send <id>` applies it.
- Ownership is checked when the draft is prepared (user id for a user token, bot id for a bot token);
  someone else's message → `NOT_MESSAGE_AUTHOR`, no draft, no override. Post a threaded follow-up instead.
- `npx -y slack-axi draft list` / `draft discard <id>` — pending drafts (kind + status) / drop one.
