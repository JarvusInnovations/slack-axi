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

- User ids on messages (`U…`) are resolved to a display name via `cache/<team>/users.json`. The cache
  is seeded in bulk from `users.list` (primary-workspace members) and filled on demand from
  `users.info` for any id the bulk roster misses. `--fields user_id` adds the raw id when needed.
- **External / shared-channel / guest fallback.** Slack Connect collaborators and some guests are
  **not** in `users.list`, so a bulk-only cache renders them as raw ids. On any miss, the resolver
  falls back to a per-id `users.info` lookup and caches the result. A command that labels many ids
  (`read`, `thread`, `members`, `catchup`) hydrates all referenced ids — message authors **and**
  in-text `<@U…>` mentions — in a single batched pass before rendering, so resolution still costs no
  visible per-row round-trip. `users.info` has no bulk variant, so each genuine miss is one call;
  lookups are deduped and cached.
- A user is classified `external` when its `team_id` differs from the active workspace (or
  `is_stranger` is set — note `is_stranger` is *not* reliably set for verified Connect members, so the
  `team_id` mismatch is the load-bearing signal), `guest` when `is_restricted`/`is_ultra_restricted`,
  `bot` when `is_bot`, else `member`.
- **Unresolvable ids render unambiguously as `Uxxxx (unresolved)`** — never a bare id that could be
  mistaken for a resolved handle, and never a fabricated name. This is display-only: the suffix must
  never be parsed back into an id (e.g. `--from`/`resolveUserId` operate on the raw id).

### Cache

- Stored under `~/.config/slack-axi/cache/<TEAM_ID>/` as `channels.json` and `users.json`, each with a
  `fetched_at`. Refreshed lazily when older than a TTL (default 1 hour) and on a resolution miss.
- `users.json` also holds a **negative cache** of ids that `users.info` couldn't resolve, with a
  shorter TTL (15 min) so a genuinely-unknown or deactivated id isn't re-fetched on every command, yet
  a user who later joins gets retried soon. A full `users.list` refresh clears it.
- `slack-axi cache refresh [--team <id>]` forces a rebuild (and clears the negative cache). `cache` is
  a hidden/utility command, not part of the primary surface.
- The cache is a convenience, never a correctness dependency: message *content* always comes live from
  the API; only id↔name mapping is cached.

## Principles

**Inherited:**

- [Resolve identity for the agent](../principles.md#resolve-identity-for-the-agent) — this behavior is
  its operationalization.
