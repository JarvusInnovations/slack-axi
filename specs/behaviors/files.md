# Behavior: File attachments

## Rule

Files attached to a message are **surfaced** wherever that message is read, and their bytes are
**downloadable on demand** to a local path the agent can then open. Discovery is free (the file
metadata rides on the message payload); fetching bytes is an explicit, separate step.

## Applies To

- `read` / `thread` — show the files attached to each message.
- `catchup` — flag that a message has attachments (count only; the sweep stays lean).
- `download` — fetch one or more files' bytes by file id.

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

## Principles

**Inherited:**

- [Resolve identity for the agent](../principles.md#resolve-identity-for-the-agent) — the agent gets a
  usable file id + name inline, not a raw Slack URL it would have to authenticate against itself.
- [One call returns the complete answer](../principles.md#one-call-returns-the-complete-answer) —
  attachments are surfaced from the same `history`/`replies` payload as the messages, with no extra
  round-trip just to learn a message has files.
- [Token-frugal, content-first output](../principles.md#token-frugal-content-first-output) — discovery
  is free and inline; the heavyweight byte fetch is opt-in per file.
