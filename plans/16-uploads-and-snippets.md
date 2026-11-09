---
status: in-progress
depends: [11-file-attachments, 15-mrkdwn-rendering]
specs:
  - specs/behaviors/files.md
  - specs/commands/file.md
  - specs/commands/write.md
  - specs/commands/read.md
  - specs/behaviors/auth-and-workspaces.md
  - specs/architecture.md
issues: []
---

# 16 — upload attachments, attach snippets, read snippets

## Scope

Close the three file gaps left by [`11-file-attachments`](11-file-attachments.md), which made files
read-and-download only:

1. **Upload attachments** — `draft --file <path>` attaches local files to a post.
2. **Embed snippets** — `draft --snippet <path>` attaches a local text file as a Slack snippet, with
   the syntax type taken from the extension.
3. **Read snippets** — the `files` column marks snippets, and a new `file <file-id…>` command prints a
   text file's or snippet's text inline (200 lines by default, `--full` for all).

**In:** the draft-time pin (path, size, SHA-256) and send-time check (`ATTACHMENT_CHANGED`); upload
through `getUploadURLExternal` + `completeUploadExternal` carrying the message text or first-chunk
blocks; polling `files.info` for the shared message's ts; a draft-id `delete` also removing the
uploaded files; `edit` refusing attachment flags; `files:write` in the required scope set; docs and
skill. Also fixes the `deleted: " message(s)"` literal in the multi-chunk delete confirmation (it was
meant to show the count), since this plan reworks that path.

**Out:** attachments on edits (Slack can't change a message's files); stdin or inline-string snippet
content (write a scratch file); canvases; rendering images in the CLI.

## Implements

- `specs/behaviors/files.md` — snippets, text detection, the `file` command's rules, uploading, the
  pin-the-reviewed-bytes principle.
- `specs/commands/file.md` — new command.
- `specs/commands/write.md` — `--file`/`--snippet`, optional text, attachments echo, send/delete/edit
  behavior, record fields.
- `specs/commands/read.md` — snippet marking + `file` hint.
- `specs/behaviors/auth-and-workspaces.md` — `files:write`.
- `specs/architecture.md` — out-of-scope line, module map.

## Approach

1. **`src/slack/files.ts`**: `FileMeta` gains `snippet?`/`lines?`; `summarizeFiles` renders the
   snippet form. Pure helpers `isTextFile(meta)`, `snippetType(path)`, and `clipLines(text, max)`.
   `fetchFileBytes` factored out of `downloadFile` (shared login-HTML guard). Attachment helpers:
   `pinAttachment(path, kind)` → `{path,name,size,sha256,snippet_type?}`, `verifyAttachment`, and
   `uploadAndShare(session, attachments, dest)` → file ids, then `findShareTs` polling `files.info`.
2. **`src/config.ts`**: `Draft.attachments?`, `sent.files?`, `target_files?` (for delete).
3. **`src/commands/write.ts`**: parse repeatable `--file`/`--snippet` (`takeFlags`); text optional
   with attachments; ≤10; echo `attachments[N]`; `draftSend` posts through `uploadAndShare` when
   attachments exist (human: `initial_comment`; bot: first chunk's `blocks`, `invalid_blocks` → retry
   with the blocks' text); `delete <draft-id>` carries `sent.files` → `files.delete` at send;
   `edit` refuses attachment flags.
4. **`src/commands/file.ts`** (new) + `cli.ts` registration and help.
5. **`src/commands/read.ts`**: `file` hint when a snippet is in view.
6. **`src/slack/scopes.ts`**: `files:write` in `WRITE_SCOPES` (setup manifest picks it up).
7. Docs: README command list, `skills/slack-axi/SKILL.md`.
8. Tests: `summarizeFiles` snippet form, `toFileMeta` snippet fields, `isTextFile`, `snippetType`,
   `clipLines`, `pinAttachment`/`verifyAttachment` (temp files), draft parsing of attachment flags.

## Validation

- [ ] `draft #claude-test "…" --file shot.png --snippet q.sql` echoes both attachments with kind and
      size and uploads nothing; `--preview` shows them and writes no draft.
- [ ] `draft send` posts **one** message carrying the text and both files; the confirmation shows the
      real ts, permalink, and file ids. (Live, #claude-test, human mode.)
- [ ] The `.sql` attachment shows in Slack as a SQL snippet; `read` shows it as
      `q.sql (snippet: sql, N lines) [F…]` with a `file` hint in `help[]`.
- [ ] `file <id>` prints the snippet's text with `shown: N of N lines`; a >200-line file shows 200 and
      the `--full` hint; `--full` prints all; an image id gives metadata + the `download` pointer.
- [ ] Changing a file after `draft` makes `draft send` fail with `ATTACHMENT_CHANGED` and upload
      nothing.
- [ ] `--snippet` on a binary file → `USAGE`; 11 attachments → `USAGE`; `edit … --file` → `USAGE`.
- [ ] `delete <sent-draft-id>` on the attachment post removes the message and its files.
- [ ] A reply draft with `--file` lands in the thread.
- [ ] `doctor` reports `files:write` missing until the app is re-installed with it.
- [ ] `bun run test`, `typecheck`, `lint`, `format:check`, `build` clean.

## Risks / unknowns

- **`files:write` is a breaking scope add**, like `files:read` in plan 11: `doctor` warns until each
  app is re-installed; only attachment sends need it.
- **The share ts is eventually consistent.** `completeUploadExternal` doesn't return it; `files.info`
  `shares` can lag. Polled with a bound; `ts: pending` is the documented fallback.
- **Blocks on `completeUploadExternal`** are documented but less exercised than `chat.postMessage`;
  bot mode falls back to the blocks' text on `invalid_blocks`.

## Notes

## Follow-ups
