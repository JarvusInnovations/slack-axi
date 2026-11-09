# Behavior: File attachments

## Rule

Files attached to a message are **surfaced** wherever that message is read, and their bytes are
**downloadable on demand** to a local path the agent can then open. Discovery is free (the file
metadata rides on the message payload); fetching bytes is an explicit, separate step. A text file —
a **snippet** above all — can also be **read inline** as text. Outgoing, a draft can **attach local
files and snippets**; nothing is uploaded until the draft is sent.

## Applies To

- `read` / `thread` — show the files attached to each message.
- `catchup` — flag that a message has attachments (count only; the sweep stays lean).
- `download` — fetch one or more files' bytes by file id.
- `file` — show one or more files' metadata and, for text files and snippets, their text.
- `draft --file / --snippet` and `draft send` — attach local files to an outgoing post.

## Details

### Discovery (no extra call, no extra scope)

- `conversations.history` / `conversations.replies` embed a `files[]` array on each message. The
  normalized `Msg` carries each file's `id`, `name`, `title`, `mimetype`, `filetype`, `size`, and
  `permalink`. **No `files.info` call and no `files:read` scope are needed to *see* that a message has
  attachments** — only to download their bytes.
- A file the viewer can't access (tombstoned/deleted, or `file_access: access_denied`) is surfaced as
  **unavailable** with whatever id is known, never silently dropped — the agent should know something
  was attached even if it can't be fetched.

### The file id is the handle

A file `id` (`F…`) is the stable handle for a file, exactly as `ts` is for a message. `read`/`thread`
output includes it so the agent can pass it straight to `download` — no URL, no browser, no copy-paste
from Slack's web UI.

### Download (requires `files:read`)

- `download <file-id…>` resolves each id via `files.info`, then fetches `url_private_download` with the
  workspace token as a Bearer credential, writing the bytes to a local file.
- **`files:read` is required** and is part of the standard scope set (see
  [auth-and-workspaces.md](auth-and-workspaces.md)). Without it Slack returns its login HTML (HTTP 200,
  `text/html`) instead of the bytes; the command detects this and the missing scope and returns a
  `SCOPE_MISSING` error naming `files:read` rather than writing a corrupt file.
- Bytes are written to the chosen output directory (default: the current working directory) under the
  file's name; a name collision falls back to `<id>-<name>`. The command's output is the **absolute
  local path** of each saved file, so the agent can hand it directly to its own file-reading tool to
  view an image/PDF.
- Download is **never automatic** — reading a thread lists attachments but fetches nothing; the agent
  chooses what is worth bytes and disk. This keeps reads token- and disk-frugal.

### Snippets

A **snippet** is a Slack file whose `mode` is `snippet`: text with a syntax type (`python`, `sql`, …),
shown in Slack as a code viewer. To Slack's API it is just a file, so the rules above apply to it
unchanged (same id handle, same `download`). On top of that:

- The `files` summary marks it: `query.sql (snippet: sql, 42 lines) [F-id]` in place of the
  `(filetype, size)` meta. The syntax type is the file's `filetype`; the line count is the payload's
  `lines` field and is omitted when absent.
- When any file in a `read`/`thread` view is a snippet, `help[]` points at `file <file-id…>` to read it.

### Reading text inline (`file`, requires `files:read`)

- A file is **text** when it is a snippet, its mimetype is `text/*`, or its mimetype is one of
  `application/json`, `application/xml`, `application/javascript`, `application/x-yaml`,
  `application/x-sh`. Anything else is **binary**.
- `file <file-id…>` fetches each text file's bytes the same way `download` does (same `files:read`
  requirement, same login-HTML guard) and prints the text in the output instead of writing it to disk.
  A binary file gets its metadata and a pointer to `download`; its bytes are never printed.
- Text is shown up to **200 lines** by default. A longer file is cut at 200 lines, and the output says
  so (`shown: 200 of 812 lines`, plus a `--full` hint in `help[]`); `--full` prints every line.
  Never silently truncated.

### Uploading (requires `files:write`)

- `draft <channel> ["<markdown>"] --file <path>` attaches a local file to the post; `--snippet <path>`
  attaches a local text file as a **snippet**. Both repeat and mix; the message text is optional when
  at least one attachment is given. All attachments land on **one** message, the message carrying the
  text (in bot mode: the first chunk). At most **10** attachments per draft (Slack's per-message limit).
- Slack itself turns most **text** uploads into snippets, even ones sent with `--file` (verified live:
  a `.json` sent with `--file` came back with `mode: snippet`, type `json`). So for a text file the
  two flags differ only in who picks the syntax type: `--snippet` sets it from the extension and refuses
  binaries; `--file` leaves it to Slack's detection. A text file cannot be forced to stay a plain
  attachment.
- A snippet's syntax type comes from its file extension (`.py` → `python`, `.ts` → `typescript`,
  `.sql` → `sql`, `.json` → `json`, `.sh` → `shell`, `.md` → `markdown`, `.yml`/`.yaml` → `yaml`, …);
  an unknown extension is `text`. A file passed to `--snippet` must be text (no NUL bytes); a binary
  file is refused with `USAGE`, pointing at `--file`.
- **Preparing a draft uploads nothing.** `draft` checks each path (exists, is a regular file, is not
  empty) and records its absolute path, name, size, and SHA-256 digest. The bytes stay on local disk.
- **What was reviewed is what is sent.** `draft send` re-reads each file and compares its digest to the
  recorded one. Any mismatch, or a missing file, refuses the send with `ATTACHMENT_CHANGED`, names the
  file, and uploads nothing. Re-create the draft to send the new contents.
- `draft send` uploads each file (`files.getUploadURLExternal`, then the bytes to the returned URL),
  then shares them all in one `files.completeUploadExternal` call that carries the message: the
  rendered text as `initial_comment` (human mode or `--raw`) or the first chunk's `blocks` (bot mode).
  Remaining bot-mode chunks post as plain messages after it, as for any multi-chunk post.
- Slack does not return the shared message's `ts` from `completeUploadExternal`. `draft send` polls
  `files.info` for the file's share in the target channel (up to about 10 seconds) to learn it. If the
  share never shows up, the send still succeeds and reports the uploaded file ids with
  `ts: pending`. A later `edit`/`delete <draft-id>` looks the share up again (and records it); if Slack
  still hasn't reported it, the command fails with `SHARE_PENDING` and asks to retry shortly.
- Deleting a sent attachment post by its **draft id** removes the message **and** the files the draft
  uploaded (`files.delete`): the agent asked to take back what it posted, and an orphaned file would
  stay visible in the channel's file list. Deleting by `<channel> <ts>` removes the message only.
- An **edit** cannot add, remove, or replace attachments (`chat.update` cannot change files). `edit`
  refuses `--file`/`--snippet` with `USAGE`; it can still change the text of an attachment post.

## Principles

**Inherited:**

- [Resolve identity for the agent](../principles.md#resolve-identity-for-the-agent) — the agent gets a
  usable file id + name inline, not a raw Slack URL it would have to authenticate against itself.
- [One call returns the complete answer](../principles.md#one-call-returns-the-complete-answer) —
  attachments are surfaced from the same `history`/`replies` payload as the messages, with no extra
  round-trip just to learn a message has files.
- [Token-frugal, content-first output](../principles.md#token-frugal-content-first-output) — discovery
  is free and inline; the heavyweight byte fetch is opt-in per file. The same goes for snippet text,
  which `file` prints only on request and caps at 200 lines.
- [Writes are safe by default](../principles.md#writes-are-safe-by-default) — attaching files is part
  of a draft; bytes leave the machine only at `draft send`, and only the bytes that were reviewed.

**Local:**

- **Pin the reviewed bytes.** A draft is approved on what it shows, so anything that could change
  between approval and send is pinned when the draft is prepared and checked at send. If a check
  fails, refuse the send. Do not send the newer contents, and do not try to repair the draft.
