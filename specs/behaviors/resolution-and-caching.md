# Behavior: Identity resolution and caching

## Rule

Channels are addressable by `#name`, bare `name`, or id (`C0…`/`G0…`/`D0…`) interchangeably; user ids
in output are resolved to display names. Resolution is backed by a local per-workspace cache so it
costs no visible round-trip.

## Applies To

Every command that takes a channel argument (`read`, `thread`, `search --in`, `members`, `react`,
`draft`) and every command that displays authors/participants (`read`, `thread`, `search`, `dms`,
`members`).

## Details

### Channel resolution

- Accept `#general`, `general`, or a raw id. A leading `#` is stripped. Anything matching the id shape
  (`C`/`G`/`D` + alphanumerics) is treated as an id and used directly.
- Name → id lookup uses the cached channel list (`cache/<team>/channels.json`), which is built from
  `users.conversations` across **all** types the user belongs to, plus `conversations.list` results
  the agent has touched. This is why private channels and group DMs resolve by name — they're in the
  member-scoped cache.
- On a name miss: refresh the cache once and retry. If still unresolved, return a structured error
  with the closest fuzzy matches as suggestions (see [errors.md](errors.md)) — never a bare failure.
- Channel output **always pairs name and id** (`#general (C0123ABCD)`), so a consumer can lift the
  HQ `{name, id}` pair directly (see [permalinks.md](permalinks.md)).

### User resolution

- User ids on messages (`U…`) are resolved to a display name via `cache/<team>/users.json` (from
  `users.info`/`users.list`). Output shows the name; `--fields user_id` adds the raw id when needed.
- Unresolvable users fall back to the raw id rather than erroring.

### Cache

- Stored under `~/.config/slack-axi/cache/<TEAM_ID>/` as `channels.json` and `users.json`, each with a
  `fetched_at`. Refreshed lazily when older than a TTL (default 1 hour) and on a resolution miss.
- `slack-axi cache refresh [--team <id>]` forces a rebuild. `cache` is a hidden/utility command, not
  part of the primary surface.
- The cache is a convenience, never a correctness dependency: message *content* always comes live from
  the API; only id↔name mapping is cached.

## Principles

**Inherited:**

- [Resolve identity for the agent](../principles.md#resolve-identity-for-the-agent) — this behavior is
  its operationalization.
