# Command: download

Fetch the bytes of one or more files attached to Slack messages, saving each to a local path the agent
can then open (e.g. to view a screenshot or read a PDF). The download counterpart to the file metadata
surfaced inline by `read`/`thread`. See [behaviors/files.md](../behaviors/files.md).

## Invocation

```
slack-axi download <file-id…> [--out <dir>] [--team <id>]
```

- One or more file ids (`F…`), as shown in a `read`/`thread` `files` column.
- `--out <dir>` — directory to write into (default: the current working directory). Created if absent.
- `--team <id>` — workspace selection as usual; required form when multiple workspaces are stored only
  for *mutations* (download is read-only, so it falls back to the default freely).

## Data Requirements

- `files.info` per id for the canonical file object (name, mimetype, `url_private_download`).
- The file bytes from `url_private_download`, fetched with the workspace token as a Bearer credential.
- **Scope: `files:read`** (part of the standard read set — see
  [auth-and-workspaces.md](../behaviors/auth-and-workspaces.md)).

## Output Rules

Per [output-format.md](../behaviors/output-format.md). A workspace header, then a
`downloaded[N]{file,name,type,size,path}` list — `path` is the **absolute** local path of each saved
file. Any id that couldn't be fetched is reported separately rather than failing the whole batch.

```
workspace: Code for Philly (T03NV85SZ)
downloaded[2]{file,name,type,size,path}:
  F0B8Q0DCAA3,IMG_2731.jpg,jpg,158KB,/home/me/shots/IMG_2731.jpg
  F0B9ZNJ1EBS,IMG_2732.jpg,jpg,92KB,/home/me/shots/IMG_2732.jpg
help[1]:
  Open a saved path with your file-reading tool to view the image/PDF
```

- **Partial success**: resolved files are saved and listed; unresolved/inaccessible ids are listed in
  a `help[]` `Failed:` line with the reason. When **none** succeed, exit non-zero.
- **Missing `files:read`**: a `SCOPE_MISSING` error naming `files:read` (and pointing at `auth setup`
  to re-grant), detected from the API error or a `text/html` (login) response body — never a saved
  corrupt file.
- **Unknown id** → `FILE_NOT_FOUND`; a tombstoned/inaccessible file → reported failure, not a crash.

## Actions

Writes file(s) to the local filesystem (read-only against Slack). No Slack mutation.

## Navigation

Reached from a `read`/`thread` view whose `files` column lists attachment ids. Pairs with the agent's
own file-reading tool, which opens the saved path to view the content.

## Principles

**Inherited:**

- [One call returns the complete answer](../principles.md#one-call-returns-the-complete-answer) — a
  batch of ids downloads in one invocation; the output is ready-to-open paths.
- [Token-frugal, content-first output](../principles.md#token-frugal-content-first-output) — bytes are
  fetched only when explicitly asked for, not as a side effect of reading.
