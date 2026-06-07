# Behavior: Output format

## Rule

All command output is TOON on stdout, following the AXI standards (see the `axi` skill). Minimal
default schemas, truncated long content, pre-computed aggregates, definitive empty states, and a
contextual `help[]` footer on lists and mutations.

## Applies To

Every command. The shared `output/render.ts` + `output/schema.ts` modules implement this once.

## Details

### Encoding

- TOON via `@toon-format/toon`. Internal logic stays on JSON; conversion happens only at the output
  boundary. Progress/diagnostics go to stderr, never stdout.

### Schemas

- Lists default to the smallest useful schema (3–4 fields). Examples: channels →
  `{id,name,type,unread}`; messages → `{time,author,text,ts}`; search hits →
  `{channel,author,when,text,ts}`. The `ts` is the compact citation handle, not the full permalink —
  permalinks are opt-in (`--cite`) or on-demand (`cite`); see [permalinks.md](permalinks.md).
- A `--fields <a,b,c>` flag adds columns. Unknown field names are silently ignored (lenient), per AXI
  convention. Known extras per command are listed in that command's spec.
- Long-form content (full message bodies, channel purpose/topic) belongs in detail views, not list
  rows.

### Truncation

- Free-text fields (`text`, `purpose`) truncate to ~500 chars with an ellipsis and the total length
  noted. A `--full` flag (or the relevant detail view) returns untruncated content. Never omit a large
  field entirely — always show a truncated preview plus its size.

### Aggregates

- Every list header carries the **total**, not just the page size: `messages[12 of 12]`,
  `channels[5 of 47]`. Derived counts the agent would otherwise fetch (`reply_count`, `unread`,
  `member_count`) are included inline where the backend provides them cheaply.

### Empty states

- A zero result states the zero with context and signals success, e.g.
  `messages: 0 messages in #eng between 2026-05-30 and 2026-06-06 (America/New_York)` or
  `channels: 0 channels match "xyz"`. Never ambiguous/blank output that invites a re-run.

### Contextual help

- Lists and mutations end with `help[]`: a few fully-formed, relevant next-step commands carrying
  forward disambiguating flags (`--team`, `--in`). Self-contained detail views and plain confirmations
  omit `help[]`. Errors carry the specific fixing command (see [errors.md](errors.md)).

### Noise filtering (optional, opt-in)

HQ ingestion routinely discards automation chatter (standup-bot prompts, deploy notifications, routine
PR-link posts). `read` supports `--exclude-bots` to drop messages from bot/app users, and the schema
exposes an `is_bot`/`subtype` signal so an agent can filter itself. Off by default (never hide content
silently); when on, the count reflects what was filtered (`messages[8 of 12, 4 bot-filtered]`).

## Principles

**Inherited:**

- [Token-frugal, content-first output](../principles.md#token-frugal-content-first-output) — this
  behavior is its operationalization.
- [Never silently truncate](../principles.md#never-silently-truncate) — totals, truncation-size notes,
  and the bot-filter count all serve it.
