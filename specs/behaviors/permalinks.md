# Behavior: Permalinks and HQ citations

## Rule

Every message slack-axi emits — in `read`, `thread`, and `search` output — carries a **ready-to-use
permalink** and its **raw `ts`**. The agent never assembles a permalink by hand.

## Applies To

`read`, `thread`, `search`. Any command that returns individual messages.

## Details

### Permalink

- Each message row includes a `permalink` field: a complete, clickable URL of the form
  `https://<workspace>.slack.com/archives/<channel_id>/p<ts_without_dot>` (and `?thread_ts=…` for a
  reply). Prefer Slack's `chat.getPermalink` when cheap; otherwise construct it — the construction
  (strip the `.` from `ts`) is slack-axi's job, never the agent's.
- The workspace subdomain comes from the resolved team (e.g. `jarvus`).

### Raw ts retained

- The raw `ts` (e.g. `1717589640.123456`) is always available — as a column with `--fields ts`, and
  always in `thread`/detail views — because downstream citation formats need it.

### HQ citation alignment (primary downstream consumer)

The HQ journal records Slack references in two shapes; slack-axi output must drop into both with no
string surgery:

- **Channel reference** — HQ `slack_channels` is an array of `{name, id}`. slack-axi's channel output
  always pairs name and id (see [resolution-and-caching.md](resolution-and-caching.md)), so the agent
  can lift `{name, id}` directly.
- **Message source** — HQ `slack_message` source carries `channel` (id), `ts`, and `permalink`.
  slack-axi emits all three per message, so building an HQ source is a field copy, not a computation.

`read`/`search` support `--fields permalink,ts` (permalink is in the default `read` schema; `ts` is
opt-in) so an agent ingesting into HQ gets exactly the citation fields it needs.

## Principles

**Inherited:**

- [One call returns the complete answer](../principles.md#one-call-returns-the-complete-answer) —
  the permalink is the canonical example: precompute what the agent would otherwise hand-assemble.
