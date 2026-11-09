# Command: file

Show one or more files attached to Slack messages: their metadata and, for text files and snippets,
their text, inline in the output. This is the read-it-here counterpart to `download`, which saves the
bytes to disk. See [behaviors/files.md](../behaviors/files.md).

## Invocation

```
slack-axi file <file-id…> [--full] [--team <id>]
```

- One or more file ids (`F…`), as shown in a `read`/`thread` `files` column.
- `--full` — print every line of each text file (default: the first 200 lines).
- `--team <id>` — workspace selection as usual (read-only, so it falls back to the default freely).

## Data Requirements

- `files.info` per id for the canonical file object (name, mimetype, filetype, mode, size, lines,
  permalink, `url_private_download`).
- For a text file only: its bytes from `url_private_download`, fetched with the workspace token as a
  Bearer credential (same path and same login-HTML guard as `download`).
- **Scope: `files:read`.**

## Display Rules

Per [output-format.md](../behaviors/output-format.md). A workspace header, then one block per file:

```
workspace: Jarvus (T024GATE8)
file: F0B8Q0DCAA3
name: query.sql
type: sql
snippet: true
size: 2KB
lines: 42
shown: 42 of 42 lines
permalink: https://jarvus.slack.com/files/U…/F0B8Q0DCAA3/query.sql
content: |
  SELECT id, name
  FROM stops
  …
```

- `snippet: true` appears only for snippets. `lines` is the file's total line count.
- **Text file**: `shown: N of M lines` always appears, so a cut is visible. The text follows under
  `content: |`, each line indented two spaces, verbatim (no mrkdwn resolution, no reflow). When the
  file has more than 200 lines and `--full` is absent, only the first 200 are printed, and `help[]`
  names `--full`.
- **Binary file**: metadata only, plus `content: (binary — use download)`, and `help[]` gives the
  exact `slack-axi download <id>` command.
- Several ids: blocks are separated by a blank line, in argument order.
- **Partial success**: an id that can't be fetched (`FILE_NOT_FOUND`, unavailable) is listed in a
  `help[]` `Failed:` line with the reason; the others still print. When **none** succeed, exit
  non-zero. Missing `files:read` → `SCOPE_MISSING` naming `files:read`, as for `download`.

## Actions

None. Read-only against Slack, and nothing is written to disk.

## Navigation

Reached from a `read`/`thread` view whose `help[]` points at `file` (shown whenever a snippet is in
view), or from any `files` column id. A binary file leads on to `download`.

## Principles

**Inherited:**

- [One call returns the complete answer](../principles.md#one-call-returns-the-complete-answer) — the
  text lands in the output, with no download-then-read round-trip for a snippet.
- [Never silently truncate](../principles.md#never-silently-truncate) — `shown: N of M lines` is
  always printed, and a cut always comes with the `--full` hint.
- [Token-frugal, content-first output](../principles.md#token-frugal-content-first-output) — text is
  printed only on request and capped by default; binary bytes are never printed.
