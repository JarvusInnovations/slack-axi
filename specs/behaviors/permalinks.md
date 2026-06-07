# Behavior: Message handles, permalinks, and HQ citations

## Rule

Every message slack-axi emits carries a compact, stateless **handle** — its `ts` — which is all that's
needed to reconstruct a permalink later. The full permalink is **not** rendered per row by default
(it's ~60 chars of poorly-tokenizing URL the agent rarely cites); instead it is materialized on demand
by `cite`, or inlined explicitly via `--cite` / `--fields permalink`. The agent never assembles a
permalink by hand — slack-axi does the `p<ts_without_dot>` surgery — but it pays for permalinks only
when it actually cites.

## Applies To

`read`, `thread`, `search` (emit the `ts` handle); `cite` (reconstructs permalinks from handles).

## Details

### The handle is the `ts`

- A permalink is fully derivable from `(workspace, channel_id, ts)`. For a `read`/`thread`, the
  workspace and channel are fixed and already in the output header, so the only per-message variable is
  the `ts`. The `ts` is therefore the **minimal stateless citation key** — no shorter handle exists
  without introducing state (a per-read ordinal like `#5` can't be resolved by a follow-up command in a
  fresh shell).
- The handle is the **decimal `ts` itself**, not a denser encoding. Considered and rejected:
  base62/base64 packing shrinks the ~51-bit ts from 16 chars to ~9, but the cost that matters is
  *tokens*, not characters — digit runs tokenize at ~3/token (~6 tokens for the full ts), while
  high-entropy mixed-case strings have no BPE merges and tokenize at ~1 token/char (~5–9 tokens for 9
  base62 chars). So a denser alphabet is a token wash-or-worse while losing three real properties: the
  handle would no longer *be* the Slack `ts` (forcing a decode step in `thread`/`react`/`draft`/`cite`),
  it would be case-sensitive and copy-fragile, and it would be illegible. Delta-encoding against a
  header `epoch_base` is the only representation that genuinely saves tokens (~2/row) but reintroduces
  cross-invocation state (`cite` would need the base), which defeats the stateless-handle goal. Decimal
  `ts` is near token-optimal, zero-decode, robust, and self-contained.
- `ts` is rendered dotless and compact (`1717589640123456`, ~16 chars / ~6–8 tokens) and is in the
  **default** `read`/`search` schema. It is the citation key downstream commands consume.

### Permalink, on demand

- `slack-axi cite <channel> <ts> [<ts> …]` reconstructs a complete permalink for each handle:
  `https://<workspace>.slack.com/archives/<channel_id>/p<ts_without_dot>` (plus `?thread_ts=…` for a
  reply). It is **stateless** — channel + ts is all it needs; no read-session state is retained.
- `cite` also emits the full HQ `slack_message` source shape per message (see below), so producing a
  citation is a single follow-up call over just the messages being cited.
- Inline option: `read`/`search` accept `--cite` (alias for `--fields permalink`) to materialize
  permalinks in-row up front — for the bulk-ingest case (e.g. an HQ sweep) where most messages will be
  cited and the per-row cost is worth avoiding a second call.
- `thread <channel> <ts>` is a focused detail view (one thread), so it **may** include permalinks
  inline — the per-row cost is bounded and the intent is usually citation.

### HQ citation alignment (primary downstream consumer)

The HQ journal records Slack references in two shapes; slack-axi output drops into both with no string
surgery by the agent:

- **Channel reference** — HQ `slack_channels` is an array of `{name, id}`. slack-axi's channel output
  always pairs name and id (see [resolution-and-caching.md](resolution-and-caching.md)), so the agent
  lifts `{name, id}` directly.
- **Message source** — HQ `slack_message` source carries `channel` (id), `ts`, and `permalink`. The
  `ts` is in every read row; `cite` (or `--cite`) supplies `channel` + `permalink`. So building an HQ
  source is a field copy, not a computation.

## Principles

**Inherited:**

- [One call returns the complete answer](../principles.md#one-call-returns-the-complete-answer) —
  applied with a token-cost nuance: precompute the cheap **handle** (`ts`) on every row so no state is
  needed, and reconstruct the expensive **permalink** on demand for only the messages cited. slack-axi
  still owns the string surgery; it just defers the bytes until they're wanted.
- [Token-frugal, content-first output](../principles.md#token-frugal-content-first-output) — permalinks
  are opt-in precisely because they're the costliest field and the least-often used; see
  [output-format.md](output-format.md).
