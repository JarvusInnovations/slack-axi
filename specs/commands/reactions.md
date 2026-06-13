# Command: reactions

Read the **full reactor roster** for a single message — every emoji and the complete, identity-resolved
list of who reacted with it. The read counterpart to the `react` write verb. See
[reactions.md](../behaviors/reactions.md).

## Invocation

```
slack-axi reactions <channel> <ts>
```

`<channel>` accepts `#name`/name/id (see
[resolution-and-caching.md](../behaviors/resolution-and-caching.md)); `<ts>` is a handle from a prior
`read`/`search`/`thread` row, in dotless (`1717589640123456`) or dotted (`1717589640.123456`) form.

## Data Requirements

- `reactions.get` with `full=true` for the resolved channel + ts — the only source Slack guarantees
  returns the **complete** reactor list (the embedded `conversations.history` roster is truncated; see
  [reactions.md](../behaviors/reactions.md)).
- User cache for resolving reactor ids to names; permalink for the reacted message.

## Output Rules

Per [output-format.md](../behaviors/output-format.md). A header identifies the workspace and channel
and echoes the reacted message itself (author + truncated text + `ts` handle + permalink) so the agent
has citation context in one call. Then a `reactions[N]{emoji,count,users}` list, ordered **count
descending** (ties keep native order), `users` comma-joined resolved names. `complete: true` — the
roster is the full one Slack returns.

```
workspace: Acme (T01ABC)
channel: #eng (C0B, public)
message: "09:14 alice: Shipping the auth fix today" (1717589640123456)
permalink: https://acme.slack.com/archives/C0B/p1717589640123456
complete: true
reactions[2]{emoji,count,users}:
  :tada:,3,"alice, bob, carol"
  :eyes:,1,dave
```

- Self-contained detail view — no `help[]`.
- Emoji rendered with colons; raw Slack name preserved including skin-tone/modifier suffixes
  (`:+1::skin-tone-3:`). See [reactions.md → Emoji naming](../behaviors/reactions.md).
- Reactor ids resolve display → real → handle → id; external/deactivated users not in the directory
  fall back to raw id.
- **No reactions** on the message → a definitive empty state naming the channel + ts; exit 0:

  ```
  reactions: 0 reactions on #eng message 1717589640123456
  ```

- Message not found in the channel → `MESSAGE_NOT_FOUND` (mirrors `thread`), with a suggestion to
  check the ts and channel.

## Actions

None (read-only).

## Navigation

Reached from a `read`/`thread` view that shows the inline counts-only `reactions` column — its `help[]`
points here for the names. Pairs with `cite` (this view already carries the message's permalink).

## Principles

**Inherited:**

- [Never silently truncate](../principles.md#never-silently-truncate) — this command exists to serve
  the **complete** roster from `reactions.get full=true`; it never falls back to the truncated embedded
  list.
- [One call returns the complete answer](../principles.md#one-call-returns-the-complete-answer) — the
  header carries the reacted message + permalink alongside the roster, so the agent doesn't need a
  second call to cite what it found.
- [Resolve identity for the agent](../principles.md#resolve-identity-for-the-agent) — reactor ids are
  resolved to names.
