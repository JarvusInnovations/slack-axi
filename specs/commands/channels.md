# Command: channels (and dms, members)

Discovery commands. The default surfaces the conversations the user actually belongs to — across **all
types** — fixing the documented failure where private channels and group DMs were undiscoverable.

## Commands / invocations

### `channels [--type <t>] [--all] [--match <q>] [--limit <n>] [--fields <a,b>]`

- Default: the user's conversations via **`users.conversations`** across **all** types
  (`public_channel,private_channel,mpim,im`). The agent does not pick types to see private channels or
  group DMs — they're included by default.
- `--type public|private|mpim|im` filters.
- `--all` lists the entire workspace's public+private channels via `conversations.list` (paginated to
  completion), with an `is_member` column, not just the user's memberships. (DMs/group DMs are not part
  of `--all`; use `dms`.)
- `--match <q>` fuzzy-filters by name (substring; member channels are the default pool, so they rank
  naturally first). This is how you **find a channel** — distinct from message `search` (plan 04).
- `--limit <n>` caps rows (default 50). When the match set exceeds the limit, output shows
  `[shown of total]` and a `help[]` hint to narrow or raise `--limit` — never a silent cap.

### `dms [--limit <n>]`

1:1 IMs (shown as `@user`) and group DMs (`mpim`). Group-DM participants are derived from the Slack
channel name (`mpdm-a--b--c-1`) with **no API call**; IM labels use the user cache. Capped like
`channels`.

### `members <channel> [--limit <n>]`

Channel members (`conversations.members`, paginated to completion) with names resolved; display capped
with a truncation hint.

## Data Requirements

`users.conversations`, `conversations.list`, `conversations.members`, plus the user cache. Channel
listings feed and refresh `cache/<team>/channels.json`. (`cache refresh` rebuilds both caches.)

## Output Rules

Per [output-format.md](../behaviors/output-format.md). Default schema `{id,name,type}` — `name` is the
display label (`#name`, `@user`, or parsed group-DM participants) and always pairs with the `id`, so
the HQ `{name,id}` pair lifts directly. Total shown (`channels[50 of 1564]`).
`--fields is_member,topic,purpose` adds columns. Definitive empty state on zero matches.

**Deferred in v1 (no cheap source):** an `unread`/mention count and most-active sorting are omitted —
`users.conversations` returns neither, and computing them would require a per-channel
`conversations.info` fan-out (1500+ calls here). Sort is by type group (public, private, mpim, im) then
name. Revisit if a bulk unread source becomes available.

```
workspace: Jarvus (T024GATE8)
channels[50 of 1564]{id,name,type}:
  C0APJ9LA4KW,#bid-colorado-airmap,public
  CHVBC6KLH,#some-private,private
  C0125N74FU1,"alice, bob, chris",mpim
help[3]:
  Run `slack-axi read <channel>` to read one (threads inlined)
  Narrow with `--match <q>` or `--type public|private|mpim|im`
  Showing 50 of 1564; raise with `--limit <n>`
```

## Actions

None (read-only). Resolution side-effect: refreshes the channel cache.

## Principles

**Inherited:**

- [Resolve identity for the agent](../principles.md#resolve-identity-for-the-agent) — name+id pairing
  and all-types defaulting serve it.
- [Never silently truncate](../principles.md#never-silently-truncate) — the `[shown of total]` count
  and `--limit` hint keep the default cap explicit.
- [Read is for windows, search is for finding](../principles.md#read-is-for-windows-search-is-for-finding)
  — `--match` finds a channel; it does not read messages.
