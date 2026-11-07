# Behavior: Outgoing text rendering (Markdown → mrkdwn or Block Kit)

## Rule

**The writer writes Markdown; slack-axi owns the Slack dialect.** Text given to `draft` or `edit` is
Markdown. It is rendered at preparation time into what Slack actually displays well, according to the
workspace's **mode**, and the draft stores both the source and the rendering so the reviewer sees
exactly what will be sent.

| Mode | Token | Renders to | Why |
| --- | --- | --- | --- |
| `human` (default) | user token, `xoxp-` | **mrkdwn text** (`chat.postMessage` `text`) | a person who later edits the message in the Slack client keeps the formatting; Block Kit degrades to broken text on client edit (tested 2026-11-07) |
| `bot` | bot token, `xoxb-` | **Block Kit** blocks + a `text` fallback | nothing is hand-edited; blocks give real headers, lists, and tables |

## Applies To

`draft` (prepare) and `edit` (prepare) — the rendering happens when the draft is written, so
`draft list`, the echoed draft, and `--preview` all show the result. `draft send` sends what was
stored. Reading commands are unaffected.

## Details

### Mode

- Derived from the stored token: a recorded `bot_id` **or** an `xoxb-` prefix (records written before
  `bot_id` was captured) → `bot`, else `human`. An
  explicit override is stored on the workspace record (`token.json` → `mode`). For an env-supplied
  token the mode is derived from the identity when first needed.
- Override: `slack-axi auth mode <human|bot> [--team <id>]` sets it per workspace (`auth mode auto`
  clears the override);|bot> [--team <id>]` sets it per workspace; `SLACK_AXI_MODE`
  overrides for a single run (headless jobs). `auth mode` with no argument shows the current mode and
  whether it is derived or set.
- The home view and `doctor` show the active mode next to the identity.

### Human mode: Markdown → mrkdwn text

Rendered with `slackify-markdown`. The before/after table (the README repeats it):

| Markdown | mrkdwn |
| --- | --- |
| `**bold**`, `__bold__` | `*bold*` |
| `*em*`, `_em_` | `_em_` |
| `~~gone~~` | `~gone~` |
| `# Heading` (any level) | `*Heading*` on its own line |
| `- item` / `* item` / `+ item` | `• item` (nesting kept by indentation) |
| `1. item` | `1. item` |
| `[text](url)` | `<url\|text>` |
| bare `https://…` | `<https://…\|https://…>` |
| `` `code` ``, fenced blocks | unchanged (language tag dropped) |
| `> quote` | `> quote` |
| `---` | `***` (Slack has no rule) |
| tables | left as pipe text (Slack text has no tables) |
| `&`, `<`, `>` in prose | `&amp;`, `&lt;`, `&gt;` (Slack's required escaping) |

Paragraph breaks are preserved; intentional blank lines are not collapsed beyond Markdown's own rule
(one blank line between blocks).

**`*x*` means italic.** Markdown and mrkdwn disagree on a single asterisk (italic vs bold); the
writer writes Markdown, so `*x*` renders as `_x_`. Write `**x**` for bold. A caller that still writes
mrkdwn by hand passes `--raw`.

### Slack-native tokens pass through

Both renderers escape `<`, `>`, `&` and would break Slack's own markup. Before rendering, these are
swapped for placeholders and restored verbatim afterwards, so hand-written mrkdwn mixed into Markdown
survives:

- mentions `<@U…>`, `<@U…|name>`; channels `<#C…|name>`; specials `<!here>`, `<!channel>`,
  `<!everyone>`, `<!subteam^S…>`, `<!date^…>`
- links already in Slack form: `<url|label>`, `<url>`
- `•` bullet lines (plain text to Markdown; untouched)

### Bot mode: Markdown → Block Kit

Rendered with `@tryfabric/mack` (Jarvus fork), then **chunked** exactly as claude-assist posts
(`packages/chat/src/index.ts` → `chunkBlocks`/`postResponse`):

- at most **50 blocks** per message; at most **one `table` block** per message, and a chunk is flushed
  right after a table so the next table starts its own message;
- chunk 1 is posted with `text` = the first 3000 characters of the Markdown source (the notification
  and search fallback); later chunks with `text: (continued)`; all in the draft's channel (and thread,
  if the draft is a reply);
- if Slack answers `invalid_blocks`, that chunk is re-posted as plain text: the blocks' `text` fields
  joined by blank lines (or the Markdown source's first 3000 characters if there are none).

The same token protection applies before `markdownToBlocks`.

### `edit` renders the same way

An edit's new text goes through the mode's renderer. `chat.update` replaces `text` (and `blocks` in bot
mode) wholesale. A bot-mode edit whose rendering needs more than one chunk is refused with
`TOO_LONG_FOR_EDIT` — one message can only hold one chunk — with the suggestion to shorten or post a
threaded follow-up.

### `--raw` and `--preview`

- `--raw` (on `draft` and `edit`): skip rendering; the text is stored and sent verbatim as mrkdwn
  text, no blocks, in either mode. For callers that already write mrkdwn.
- `--preview` (on `draft` and `edit`): render and print, write nothing. Human mode prints the rendered
  mrkdwn as `text`; bot mode prints `blocks: N in M chunk(s)` with each chunk's block types and the
  `text` fallback. The exit code is 0 and no draft id is issued.

### What the draft record stores

`markdown` (the source as given), `text` (what is sent as `text`: the rendered mrkdwn in human mode, the
3000-char fallback in bot mode, or the verbatim text with `--raw`), `blocks` (bot mode only: the chunked
blocks), `raw: true` when rendering was skipped. The echoed draft shows `text` (human) or the chunk
summary (bot) so the reviewer approves the rendering, not just the source.

## Principles

**Inherited:**

- [Writes are safe by default](../principles.md#writes-are-safe-by-default) — rendering happens at
  preparation so what is approved is what is sent; `--preview` makes the rendering inspectable with no
  side effect.
- [Token-frugal, content-first output](../principles.md#token-frugal-content-first-output) — the echoed
  draft shows the rendering once; bot mode summarizes blocks rather than dumping JSON.

**Local:**

- **The writer writes Markdown; the tool owns the dialect.** Every other surface an agent writes to
  takes Markdown. Making the agent learn mrkdwn produced dense single paragraphs in practice. When
  Markdown and mrkdwn disagree (`*x*`), Markdown wins and `--raw` is the escape hatch — never a
  heuristic guess at which dialect the text "looks like".
- **Human mode never sends blocks.** Formatting a person cannot keep when they edit their own message
  in the client is worse than plain text. Richer rendering belongs to the bot, which never hand-edits.
