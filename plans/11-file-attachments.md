---
status: done
depends: [03-read, 07-catchup]
specs:
  - specs/behaviors/files.md
  - specs/commands/download.md
  - specs/commands/read.md
  - specs/commands/catchup.md
  - specs/behaviors/auth-and-workspaces.md
  - specs/architecture.md
issues: []
pr: https://github.com/JarvusInnovations/slack-axi/pull/13
---

# 11 — file attachments: surface inline + download to disk

## Scope

Let an agent (1) see that messages have file attachments while reading, and (2) download those files'
bytes to a local path it can then open (e.g. to view a screenshot).

**In:** a `files` column on `read`/`thread` (names, type, size, file id — sourced free from the
`history`/`replies` payload, no extra call/scope); a `[+N file(s)]` flag on `catchup`; a new read-only
`download <file-id…> [--out <dir>]` command backed by `files.info` + `url_private_download`; adding
`files:read` to the standard scope set.

**Out:** uploading files (write surface); rendering/transcoding images in-CLI (the agent opens the
saved path with its own file-reading tool); auto-downloading attachments during `read` (deliberately
explicit per file).

## Implements

### Own specs

- `specs/behaviors/files.md` — discovery-free-vs-download-scoped split; file id as the handle;
  unavailable-file surfacing; download requires `files:read`, writes to a local path, never automatic.
- `specs/commands/download.md` — `download <file-id…> [--out]`: `downloaded[N]{file,name,type,size,path}`,
  absolute paths, partial success, `SCOPE_MISSING`(files:read)/`FILE_NOT_FOUND`.
- `specs/commands/read.md` — inline `files` column on `read`/`thread`.
- `specs/commands/catchup.md` — `[+N file(s)]` note.
- `specs/behaviors/auth-and-workspaces.md` — `files:read` in the required scope set.
- `specs/architecture.md` — `slack/files.ts` + `commands/download.ts` in the module map.

## Approach

1. **`src/slack/files.ts`** (new): `FileMeta` interface (`id,name,title?,mimetype?,filetype?,size?,permalink?,unavailable?`);
   `toFileMeta` (handles tombstone/`file_access` → `unavailable`); pure `formatSize` (B/KB/MB) and
   `summarizeFiles` (`name (jpg, 158KB) [F…]`, `(unavailable) [F…]`) — the unit-tested seams;
   `fetchFileInfo` (`files.info` → file object) and `downloadFile` (fetch `url_private_download` with
   `Authorization: Bearer <token>`, guard against a `text/html` login body, write bytes, return path).
2. **`src/slack/threads.ts`**: extend `Msg` with `files?: FileMeta[]`; map `raw.files` in `toMsg`
   (counts/metadata only). Carried through `fetchWindow`/`fetchThread`/`fetchReplies` unchanged.
3. **`src/commands/read.ts`**: in `buildRow` compute `summarizeFiles`; add a uniform `files` column via
   the same `fill*Column` pattern as reactions (present only when some row has files). `thread` too.
   Add a `download <file-id…>` `help[]` pointer when files are present.
4. **`src/commands/catchup.ts`**: append a `[+N file(s)]` note in `buildRow` (next to the reply note).
5. **`src/commands/download.ts`** (new): `--team`, `--out` (default cwd, `mkdir -p`), positional ids;
   per-id `fetchFileInfo` → `downloadFile`; partial-success output; map `missing_scope`/html-body →
   `SCOPE_MISSING` naming `files:read`; unknown id → `FILE_NOT_FOUND`.
6. **`src/slack/scopes.ts`**: add `files:read` to `READ_SCOPES` (so `doctor` flags it until re-install).
7. **`src/slack/errors.ts`**: map `file_not_found` → `FILE_NOT_FOUND`.
8. **`src/cli.ts`**: register read-only `download`, `COMMAND_HELP`, command list, example.
9. **Discoverability**: `README.md` + `skills/slack-axi/SKILL.md` get `download <file-id…>`.
10. **`test/files.test.ts`** (new): `formatSize`; `summarizeFiles` (normal, multi, unavailable);
    `toFileMeta` (normal vs tombstone); `toMsg` carries `files`.

## Validation

- [x] `read`/`thread` over a message with attachments shows a uniform `files` column listing
      `name (type, size) [F-id]`; an attachment-free view shows no column. (Verified live on the CfP
      thread: screenshot reply shows both images; other rows empty; column absent when none present.)
- [x] The file id in the column is accepted by `download` with no transformation. (Verified: `download`
      passed the `[F…]` ids straight through to `files.info`; only the scope gate stopped it.)
- [x] `catchup` flags a message with files as `[+N file(s)]`. (Verified live in CfP #community: `[+1 file]`.)
- [x] `download <id…> --out <dir>` writes real bytes to disk and returns absolute paths; the saved
      file opens as the correct type. (Verified live once `files:read` was granted: downloaded the CfP
      screenshots `F0B8Q0DCAA3`/`F0B9ZNJ1EBS` — real JPEGs, 1206×2622, opened and viewed.)
- [x] Without `files:read`, `download` returns `SCOPE_MISSING` naming `files:read` — never a saved
      HTML/corrupt file. (Verified live pre-scope: clean error, no output dir created.)
- [x] Unknown id → `FILE_NOT_FOUND`; a tombstoned/inaccessible file → reported failure, batch continues.
      (Tombstone→`unavailable` unit-tested in `toFileMeta`; `FILE_NOT_FOUND` mapping wired in errors.ts
      and reachable now that `files:read` is granted.)
- [x] `doctor` reports `files:read` missing until the app is re-installed with it. (Verified live on
      both Jarvus and CfP: `scopes,warn,"missing files:read"`.)
- [x] `bun test` green (57 pass); `bun run build` clean; type-check clean.

## Risks / unknowns

- **`files:read` is a breaking scope add** — every existing install shows the gap in `doctor` until
  re-installed. Intended and documented; the discovery path (read columns) still works without it.
- **Login-HTML masquerade** — a missing-scope download returns HTTP 200 with HTML, not an error status.
  Mitigated by checking `files.info` errors first and sniffing the response content-type before writing.
- **Filename collisions / traversal** — sanitize to a basename; on collision fall back to `<id>-<name>`.

## Notes

- **Discovery vs. download is the whole design, and it's scope-asymmetric.** File *metadata*
  (including `url_private_download`) rides on the `conversations.history`/`replies` payload and needs
  only the history scopes — so `read`/`thread`/`catchup` surface attachments with zero new scope. Only
  fetching the *bytes* needs `files:read`. Verified live: without `files:read`, the download URL
  returns HTTP 200 with `text/html` (Slack's login page), not the image — hence the content-type guard
  in `downloadFile` plus the `files.info` `missing_scope` path, both mapping to `SCOPE_MISSING`.
- **`files:read` is a breaking scope add.** It's now in `READ_SCOPES`, so every existing install
  (Jarvus + CfP) shows `doctor: scopes warn missing files:read` until re-installed. The discovery path
  keeps working without it; only `download` is gated.
- **End-to-end verified once `files:read` was granted.** Re-installed both apps with the scope (`doctor`
  flipped to `scopes,ok`), then `download F0B8Q0DCAA3 F0B9ZNJ1EBS` pulled real JPEGs (1206×2622) that
  opened correctly — the original goal (an agent seeing thread screenshots) works full-circle.
- **`file_access`/`mode: tombstone`** mark a file unavailable; surfaced as `(unavailable) [F-id]` so the
  agent still knows something was attached.

## Follow-ups

None. (The real-bytes download path was verified end-to-end after `files:read` was granted — see Notes.)
