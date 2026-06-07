# Command: search

Find a thing across the workspace via `search.messages`. Scoped to discovery — **not** a window sweep.
For reading a channel over time, `read` is the verb (see
[principles.md → Read is for windows, search is for finding](../principles.md#read-is-for-windows-search-is-for-finding)).

## Invocation

```
slack-axi search "<query>" [--in <channel>] [--from <@user>] [--after <when>] [--before <when>]
                           [--limit N] [--fields ...]
```

## Data Requirements

`search.messages` (user-token-only). Friendly flags are translated into Slack search modifiers:
`--in #eng` → `in:#eng`, `--from @alice` → `from:@alice`, `--after 2026-05-01` → `after:2026-05-01`,
`--before` → `before:`. `--after`/`--before` accept the same human dates as `read` but bind to Slack's
day-granular modifiers.

## Output Rules

Per [output-format.md](../behaviors/output-format.md) and [permalinks.md](../behaviors/permalinks.md).
Default schema `{channel,author,when,text,ts}` — `ts` is the stateless citation handle; permalinks come
from `cite` or `--cite`, same as `read`. `when` is a human Eastern datetime; `text` is truncated with
`--full` escape. Each row pairs `channel` name+id so `cite`/HQ have what they need. Total match count
shown. **No `complete` marker** — search makes no completeness or strict-chronology guarantee, and
output says so implicitly by being a ranked match list.

```
workspace: Jarvus (T01ABC)
query: "token refresh" in:#eng
matches[7 of 7]{channel,author,when,text,ts}:
  #eng (C0B),bob,2026-06-05 09:15,"did the token refresh land?",1717589700234567
help[2]:
  Run `slack-axi read #eng --from 2026-06-05 --to 2026-06-06` to read that window completely
  Run `slack-axi cite #eng 1717589700234567` for a permalink to a match you cite
```

- The first `help[]` suggestion steers a window-shaped intent back to `read` — the documented
  search/read confusion fix.
- Definitive empty state on zero matches, suggesting broader terms or `read`.

## Actions

None (read-only).

## Principles

**Inherited:**

- [Read is for windows, search is for finding](../principles.md#read-is-for-windows-search-is-for-finding)
  — this command is the "finding" half; its `help[]` actively hands window-sweeps to `read`.
- [One call returns the complete answer](../principles.md#one-call-returns-the-complete-answer) —
  permalinks on every match.
