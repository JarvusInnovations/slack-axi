# Command: search

Find a thing across the workspace via `search.messages` (or files via `search.files`). Scoped to
discovery — **not** a window sweep of one channel. For reading a channel over time, `read` is the verb
(see [principles.md → Read is for windows, search is for finding](../principles.md#read-is-for-windows-search-is-for-finding)).

`search` differs from `read` on the completeness axis: `read` is bounded by an explicit time window and
inlines threads; `search` is bounded by a query and sweeps **all matching messages the user can see**,
oldest→newest, declaring whether the sweep was exhaustive. Both honor *Never silently truncate*.

## Invocation

```
slack-axi search "<query>" [--files] [--in <channel>] [--from <@user>] [--with <@user>] [--to <@user>]
                           [--has <x>]… [--is <x>]… [--after <when>] [--before <when>]
                           [--on <date>] [--during <month|year>] [--type <t>] [--limit N] [--cite]
```

## Data Requirements

`search.messages` (default) or `search.files` (`--files`) — both user-token-only and both covered by
the **`search:read`** scope (`files:read` is for the `files.*` methods, which this command does not
call). Missing scope → `SCOPE_MISSING` naming `search:read` and its remediation. The user cache
(`users.read`) is primed once for identity resolution and author labels; the member-channel cache is
primed when `--type` is used, to classify each match's true conversation type.

Friendly flags translate to Slack search modifiers:

| Flag | Modifier | Notes |
| --- | --- | --- |
| `--in #eng` | `in:#eng` | an id is resolved to its `#name` first |
| `--from <@user>` | `from:…` | bare name → exact `from:<@U…>`; `@handle`/id pass through |
| `--with <@user>` | `with:…` | conversations including this person (any sender) |
| `--to <@user>` | `to:…` | messages directed at this person |
| `--has <x>` (repeatable) | `has:x` | `link`, `file`, `pin`, `reaction`, `:emoji:` |
| `--is <x>` (repeatable) | `is:x` | `thread`, `pinned`, `saved` |
| `--after` / `--before` | `after:` / `before:` | date or relative span (normalized to a date) |
| `--on <date>` | `on:` | exactly that day |
| `--during <month|year>` | `during:` | e.g. `2026-05` or `2026` (passed through) |

`--type <public\|private\|mpim\|im>` has **no Slack modifier**; it is a post-filter over retrieved
matches, classified by each match's cached channel type (the `C` prefix alone can't separate public
from private). Reported honestly as a filter, never as query narrowing.

A query already containing quotes passes through verbatim (Slack phrase match).

### Identity resolution

`--from`/`--with`/`--to` take `@handle`, an id, or a bare display/real name. A bare name is resolved
against the user cache to an exact `<@U…>` so Slack matches precisely instead of fuzzily. On no match or
an ambiguous match (>1 user), it falls back to `@name` (fuzzy) and records a `help[]` note so the agent
knows the filter is imprecise.

### Pagination & completeness

Both endpoints expose `paging: {page, pages, total}`. The sweep walks pages to completion at
`sort: timestamp`, `sort_dir: asc` (oldest→newest), stopping when pages are exhausted, `--limit` is
reached, or the `1000`-match runaway ceiling is hit. **Default is exhaustive** (no `--limit` = all).
The header carries `complete: true|false` and the list a `<retrieved> of <total>` count, mirroring
`read`. If the ceiling stops the sweep, a `note:` says so. Each match already includes its `permalink`,
so `--cite` adds it with no extra call (file matches always carry a permalink).

## Output Rules

Per [output-format.md](../behaviors/output-format.md) and [permalinks.md](../behaviors/permalinks.md).

Every result set carries a **`coverage:`** header line stating the search reflects only conversations
the authenticated user belongs to (named with their id when known). This is the traceability guardrail:
a personal token cannot see private channels or DMs the user isn't in, and the header makes that
boundary explicit on every result so a partial view is never mistaken for the whole workspace.

Message schema `{channel,author,when,text,ts}` — `channel` pairs name+id; `when` is a human Eastern
datetime; `text` is truncated; `ts` is the stateless citation handle. File schema
`{title,type,author,when,id,permalink}`. Permalinks come from `--cite` (messages) or inline (files),
same citation model as `read`.

```
workspace: Acme (T01ABC)
query: "token refresh" in:#eng
coverage: @alice (U0A) — only conversations you belong to
complete: true
matches[7 of 7]{channel,author,when,text,ts}:
  #eng (C0B),bob,2026-06-05 09:15,"did the token refresh land?",1717589700234567
help[2]:
  To read a result's channel over a window, use `slack-axi read #eng --from 2026-06-05 --to 2026-06-06`
  Add `--cite` (or run `slack-axi cite #eng 1717589700234567`) for permalinks to cite
```

- The `read`-steering `help[]` line keeps a window-shaped intent pointed at `read`.
- Definitive empty state on zero matches, suggesting broader terms, dropping a filter, or `read`.
- `complete: false` is accompanied by the `<retrieved> of <total>` count and a "raise `--limit`" hint.

## Actions

None (read-only).

## Principles

**Inherited:**

- [Read is for windows, search is for finding](../principles.md#read-is-for-windows-search-is-for-finding)
  — this command is the "finding" half; its `help[]` actively hands window-sweeps to `read`.
- [Never silently truncate](../principles.md#never-silently-truncate) — exhaustive-by-default sweep,
  the `complete` marker + `<retrieved> of <total>` count, and the stated ceiling all honor it.
- [One call returns the complete answer](../principles.md#one-call-returns-the-complete-answer) —
  one invocation sweeps every match; permalinks on every match.
- [Resolve identity for the agent](../principles.md#resolve-identity-for-the-agent) — bare names in
  `--from`/`--with`/`--to` resolve to exact ids; the `coverage:` line names whose view this is.
