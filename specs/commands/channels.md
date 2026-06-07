# Command: channels (and dms, members, search channels)

Discovery commands. The default surfaces the conversations the user actually belongs to — across **all
types** — fixing the documented failure where private channels and group DMs were undiscoverable.

## Subcommands / invocations

### `channels [--type <t>] [--all]`

- Default: the user's conversations via **`users.conversations`** across **all** types
  (`public_channel,private_channel,mpim,im`). The agent does not pick types to see private channels or
  group DMs — they're included by default.
- `--type public|private|mpim|im` filters.
- `--all` lists the entire workspace via `conversations.list` (paginated to completion), not just the
  user's memberships.
- Sort: unread/most-active first, then alphabetical.

### `dms`

1:1 IMs and group DMs (`mpim`) with participant names resolved (see
[resolution-and-caching.md](../behaviors/resolution-and-caching.md)).

### `members <channel>`

Channel members (`conversations.members` + user resolution), names shown, paginated to completion.

### `search channels <query>`

Fuzzy match over cached channel name/topic/purpose; member channels ranked first. For finding a
channel by partial name. (Distinct from message `search`.)

## Data Requirements

`users.conversations`, `conversations.list`, `conversations.members`, plus the user cache. Channel
listings feed and refresh `cache/<team>/channels.json`.

## Output Rules

Per [output-format.md](../behaviors/output-format.md). Default schema `{id,name,type,unread}`; always
pair name+id so the HQ `{name,id}` pair lifts directly. Total shown (`channels[12 of 47]`).
`--fields topic,purpose,member_count,is_member` adds columns. Definitive empty state on zero matches.

```
workspace: Jarvus (T01ABC)
channels[12 of 47]{id,name,type,unread}:
  C0APJ9LA4KW,bid-colorado-airmap,public,0
  C098VDZU1CH,wmata-private-x,private,3
  G0C…,launch-team,mpim,1
help[2]:
  Run `slack-axi read <channel>` to read one (threads inlined)
  Run `slack-axi channels --all` to include channels you haven't joined
```

## Actions

None (read-only). Resolution side-effect: refreshes the channel cache.

## Principles

**Inherited:**

- [Resolve identity for the agent](../principles.md#resolve-identity-for-the-agent) — name+id pairing
  and all-types defaulting serve it.
- [Read is for windows, search is for finding](../principles.md#read-is-for-windows-search-is-for-finding)
  — `search channels` finds a channel; it does not read messages.
