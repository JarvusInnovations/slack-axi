---
status: in-progress
depends: [14-edit-delete]
specs:
  - specs/behaviors/mrkdwn.md
  - specs/commands/write.md
  - specs/commands/auth.md
  - specs/behaviors/auth-and-workspaces.md
  - specs/architecture.md
issues: [19]
---

# 15 — render Markdown on the way out: mrkdwn text (human mode) or Block Kit (bot mode)

## Scope

The writer writes Markdown; slack-axi owns the Slack dialect. `draft`/`edit` text is rendered at
preparation time according to the workspace's **mode**:

- **human** (`xoxp-` user token, the default): Markdown → Slack **mrkdwn text** via
  `slackify-markdown`, with Slack-native tokens (`<@U…>`, `<#C…|…>`, `<!here>`, `<url|label>`,
  `<url>`, `•` bullets) protected so hand-written mrkdwn passes through. Never blocks — a person
  editing their own message in the Slack client loses Block Kit formatting (tested 2026-11-07).
- **bot** (`xoxb-` bot token): Markdown → **Block Kit** via `@tryfabric/mack` (Jarvus fork: native
  tables, rich_text lists, entity fixes), chunked the way claude-assist's `postResponse` does it
  (≤50 blocks per message, one table per message with a flush after it, `text` = first 3000 chars of
  the Markdown on the first chunk and `(continued)` after, `invalid_blocks` → fall back to the blocks'
  text joined).

**In:** `slack/mrkdwn.ts` (human renderer + token protection), `slack/blocks.ts` (bot renderer +
chunking), mode on the workspace record (derived from `auth.test` `bot_id`; `auth mode [human|bot]`
to view/override), `--raw` (send verbatim), `--preview` (show what would be sent without writing a
draft), draft record carries `markdown` (source) alongside `text`/`blocks`, `edit` renders through the
same path (deferred from [`14-edit-delete`](14-edit-delete.md)); a bot-mode edit that would need more
than one chunk is refused (`TOO_LONG_FOR_EDIT`). README before/after table; skill.

**Out:** editing blocks messages the tool did not post (we have no record of their blocks — `edit`
replaces text+blocks wholesale, which is what `chat.update` does anyway); a Block Kit path for human
mode (ruled out by the edit test); publishing the mack fork to npm (works as a `github:` dep via
GitHub's tarball endpoint; flagged for later).

## Implements

- `specs/behaviors/mrkdwn.md` — the two modes, rendering rules, token protection, idempotency,
  `--raw`/`--preview`, chunking, edit constraints.
- `specs/commands/write.md` — `draft`/`edit` flags and record fields; `draft send` posting chunks.
- `specs/commands/auth.md` — `auth mode`.
- `specs/behaviors/auth-and-workspaces.md` — `mode` on the workspace record; derivation + override.
- `specs/architecture.md` — dependencies (`slackify-markdown`, `@tryfabric/mack`), modules, Node ≥ 22.

## Approach

1. `bun add slackify-markdown @tryfabric/mack@github:JarvusInnovations/mack`; engines → `>=22`
   (slackify-markdown requires it; architecture already says Node 22+).
2. **`src/slack/mrkdwn.ts`**: `renderMrkdwn(markdown)` — swap Slack-native tokens for placeholders,
   run `slackifyMarkdown`, restore, trim the trailing newline. Pure; table-driven tests from the
   before/after table in the spec, plus pass-through tests for hand-written mrkdwn.
3. **`src/slack/blocks.ts`**: `renderBlocks(markdown)` → `{ chunks: KnownBlock[][] }` with the same
   token protection (mack escapes `<`/`>` otherwise), `chunkBlocks` lifted from claude-assist,
   `blocksText(chunk)` for the `invalid_blocks` fallback, `summarizeBlocks(chunks)` for `--preview`.
4. **Mode**: `StoredToken.mode?`; `auth login` derives `bot_id ? "bot" : "human"`; `auth mode
   [human|bot] [--team]` shows/sets; `Session.mode` (env token: derived from `ensureIdentity`).
   `SLACK_AXI_MODE` env override for headless runs.
5. **`write.ts`**: `renderOutgoing(session, markdown, { raw })` returns `{ text, blocks?, chunks }`;
   `draftCreate`/`editCommand` store `markdown` + rendered `text` (+ `blocks` in bot mode); `--preview`
   prints `mode`, the rendered `text` (human) or `blocks: N in M chunk(s)` with block types (bot) and
   exits without writing. `draftSend` posts chunk-by-chunk (bot) or the text (human); `chat.update`
   with `text`+`blocks` for a bot-mode edit (refuse >1 chunk).
6. Docs: README before/after table + `--raw`/`--preview`; skill.

## Validation

- [ ] Human mode: the spec's before/after table renders exactly (unit-tested); `*bold*` written as
      Markdown emphasis becomes `_bold_` and `**bold**` becomes `*bold*` (documented).
- [ ] Hand-written mrkdwn passes through unchanged: `<@U…>`, `<#C…|name>`, `<!here>`, `<url|label>`,
      `<url>`, `•` lines, code spans/fences. (Unit-tested.)
- [ ] `draft --preview` prints the rendering and writes no draft; `draft --raw` stores text verbatim.
- [ ] A human-mode draft posted live renders bold/bullets/links correctly in Slack and remains editable
      with formatting intact in the client. (Live, user token.)
- [ ] Bot mode: a Markdown doc with a heading, list, table, and a 60-block body posts as ≥2 chunked
      messages with correct `text` fallbacks; `invalid_blocks` fallback path unit-tested with a fake
      client. (Blocks rendering unit-tested; live bot-token check if a bot token is available.)
- [ ] `edit` renders through the same path (deferred from [`14-edit-delete`](14-edit-delete.md)); a
      bot-mode edit needing >1 chunk is refused with `TOO_LONG_FOR_EDIT`.
- [ ] `auth mode` shows the derived mode and overrides it; `doctor`/home show the mode.
- [ ] `bun run test`, `typecheck`, `lint`, `format:check` clean; `bun run build` clean.

## Risks / unknowns

- **`*x*` ambiguity** — Markdown italic vs mrkdwn bold. Resolved for Markdown semantics (the writer
  writes Markdown); callers that still hand-write mrkdwn use `--raw` until they switch. Hari's bots are
  switching their writing spec to Markdown once this ships.
- **Zero-width spaces** — slackify-markdown wraps emphasis in U+200B so adjacent punctuation renders;
  invisible in Slack and in `read` output, but present in the stored `text`.
- **`github:` dependency** — installs via GitHub's tarball endpoint (no git needed) and the fork commits
  its build; still a non-registry dep in a published CLI. Flagged; publishing the fork is the clean fix.
- **Entity escaping** — both libraries escape `&`/`<`/`>` as Slack's API documents; protected tokens
  are restored verbatim so mentions/links survive.

## Notes

(At closeout.)

## Follow-ups

(At closeout.)
