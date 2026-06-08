---
status: done
depends: [03-read]
specs:
  - specs/commands/search.md
issues: []
---

# 04 — search

## Scope

Workspace message search via `search.messages`, scoped to "find a thing" with friendly flag → Slack
modifier translation, permalinks on matches, and `help[]` that steers window-shaped intent back to
`read`.

## Implements

- `specs/commands/search.md` — `search "<query>"` with `--in`/`--from`/`--after`/`--before`/`--limit`/
  `--fields`; modifier translation; permalink per match; no `complete` marker; read-steering help[].

## Approach

- Depends on 03 for shared time parsing (reuse `slack/time.ts` for `--after`/`--before` → day-granular
  modifiers) and the permalink + render helpers.
- Translate `--in #eng` → `in:#eng` (resolve name→`#name` form Slack expects), `--from @alice` →
  `from:@alice`, dates → `after:`/`before:`.

## Validation

- [x] `search "<q>"` returns matches with `{channel,author,when,text,ts}` (channel name+id); total
      shown. *(verified on Acme.)*
- [x] `--in`, `--from`, `--after`, `--before` translate to the correct Slack modifiers and combine.
      *(verified: `auth fix in:#general`, `deploy after:2026-03-01`.)*
- [x] Matches carry the `ts` handle; `--cite` inlines the permalink (free — search returns it) and
      `cite` resolves it on demand. *(verified, incl. `thread_ts` on a reply match.)*
- [x] Zero matches → definitive empty state suggesting broader terms or `read`. *(verified.)*
- [x] First `help[]` suggestion offers the equivalent `read <channel> --from --to` for a window sweep.
- [x] Requires `search:read`; absent scope → `SCOPE_MISSING` with the exact remediation. *(mapped in
      the command; not triggerable here since the token has the scope.)*

## Risks / unknowns

- ~~Ranking/pagination semantics~~ → **resolved**: requested `sort: timestamp`, no `complete` marker,
  and the output is framed as a match list with a `help[]` line steering window-sweeps to `read` —
  so it can't be mistaken for complete coverage.

## Notes

Verified end-to-end on Acme. `search.messages` returns each match's `username` and `permalink`
inline, so author labels and `--cite` need no extra calls — and search surfaced `alice`, the same
user `read` rendered as raw `U0EXAMPLE` (confirming that id is simply absent from the cached
`users.list`; graceful fallback, tracked under plan 03). Shares the time/format/ts/output layers from
plan 03. Committed to trunk.

## Follow-ups

- None. (Read-surface is now complete: discovery + windowed read + cite + search.)
