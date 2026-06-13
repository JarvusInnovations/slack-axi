# Behavior: Emoji reactions

## Rule

A message's reactions are surfaced in two complementary ways, split by where Slack puts **complete**
data:

- **Inline, in `read`/`thread`** — a compact, counts-only summary (`:heart:×12 :eyes:×3`) carried on
  the message row. This data is **already embedded** in the `conversations.history` /
  `conversations.replies` responses those commands already make, so it costs **no extra API call**.
- **The full reactor roster, via `reactions <channel> <ts>`** — the complete, identity-resolved list
  of *who* reacted with each emoji. This requires a dedicated `reactions.get` call.

The `count` on a reaction is **authoritative everywhere** — it is always the true total of users who
reacted. The per-reaction *reactor roster* (`users` array) is **not** complete in the embedded
`conversations.history` data: Slack documents that it "might not always contain all users that have
reacted." Only `reactions.get` with `full=true` "always return[s] the complete reaction list."

That truncation is exactly what [Never silently truncate](../principles.md#never-silently-truncate)
forbids. So slack-axi **never renders a reactor-name list from the embedded history data** — it would
be a partial list masquerading as complete. Inline views show counts only (always accurate); names are
served exclusively by the `reactions` command, which sources them from `reactions.get full=true` and
declares completeness.

## Applies To

- `read`, `thread` — emit the inline counts-only `reactions` summary.
- `reactions <channel> <ts>` — emits the full identity-resolved roster.

## Details

### Inline summary (`read` / `thread`)

- **Auto-when-present.** The `reactions` column is added only when **some** message in the view has at
  least one reaction. When no message in the view has any reaction, the column is omitted entirely (no
  empty column, no cost).
- **Uniform column.** When the column is present, **every** row carries it (empty string `""` for
  messages with no reactions). A key present on only some rows would collapse the compact TOON
  `messages[N]{cols}:` table into verbose per-field rows; keeping it uniform preserves the table. The
  column is appended last (after `ts`/`permalink`).
- **Counts only.** Each entry is `:<name>:×<count>`, space-joined, in Slack's native reaction order
  (the order the API returns, which is first-reacted-first). No reactor names inline.
- A `help[]` pointer steers the agent to `reactions <channel> <ts>` for the names when the view has
  reactions.

### Full roster (`reactions`)

- Sourced from `reactions.get` with `full=true` — the only source Slack guarantees complete.
- Reactions are ordered **count descending** (most-reacted first); ties keep native API order.
- Reactor ids are resolved to display names (see [identity resolution](#identity)); the list is
  comma-joined.
- The view declares `complete: true` — the roster is the complete one Slack returns.

### Emoji naming

- Emoji are rendered **with surrounding colons**: `:heart:`, `:tada:`.
- The raw Slack reaction name is preserved verbatim, including skin-tone and other modifier suffixes —
  e.g. `:+1::skin-tone-3:` is rendered as `:+1::skin-tone-3:`, not normalized or stripped. Two
  variants of the same base emoji (`:+1:` and `:+1::skin-tone-3:`) are distinct reactions and counted
  separately, exactly as Slack returns them.

<a id="identity"></a>

### Identity resolution

Reactor ids resolve to display names the same way message authors do (see
[resolution-and-caching.md](resolution-and-caching.md) and `userName` in `src/slack/format.ts`):
display name → real name → handle → raw id. An external (Slack Connect) or deactivated user not in the
workspace directory falls back to their raw id rather than failing.

## Principles

**Inherited:**

- [Never silently truncate](../principles.md#never-silently-truncate) — the whole split exists because
  the embedded reactor list is truncated; counts (always complete) go inline, names come only from the
  source that guarantees the complete list.
- [One call returns the complete answer](../principles.md#one-call-returns-the-complete-answer) — inline
  counts ride along on the `read`/`thread` call already being made (no N+1 for "does this have
  reactions, and how many"); the per-message roster call is paid only when the names are actually
  wanted.
- [Resolve identity for the agent](../principles.md#resolve-identity-for-the-agent) — reactor ids are
  resolved to names; the agent never sees a bare `U…` for a reactor it could have had named.
