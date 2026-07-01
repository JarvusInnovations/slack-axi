---
status: in-progress
depends: [04-search, 08-search-coverage]
specs:
  - specs/commands/search.md
issues: []
---

# 12 — search: query optional when a filter narrows

## Scope

Eliminate the hard requirement for a free-text search query. Let an agent search by filter alone —
`search --in #eng --from alice --after 2026-05-01` — which is how a scoped "what did X say in Y lately"
question is naturally expressed. This mirrors Slack's own search, where a bare modifier expression
(`in:#eng from:@alice`) is a valid query.

**In:** make the positional `<query>` optional when at least one *narrowing* filter is present; send
the modifier expression alone as the query; update `search` `--help`, the spec, README, and the skill.

**Out:** new modifiers or filters (the modifier set is unchanged); allowing a truly empty search (a
`--type`-only invocation still errors — `--type` is a post-filter with no Slack modifier, so there'd be
nothing to send); files-vs-messages behavior (unchanged).

## Implements

- `specs/commands/search.md` — the `<query>` is optional when a narrowing filter is present; the
  definition of a "narrowing filter" (any flag that becomes a Slack modifier — `--in/--from/--with/--to/
  --has/--is/--after/--before/--on/--during`; **not** `--type`); the `query:` header echoes the
  modifier-only expression when no free text is given; error `USAGE` when neither a query nor a
  narrowing filter is present, rather than sending Slack an empty query.

## Approach

1. **`src/commands/search.ts`**: replace the unconditional `if (!query)` guard with a
   `hasNarrowingFilter` check over the already-parsed flag values (excluding `--type`); error only when
   neither a query nor a narrowing filter is present. The guard still fires before `activeSession`, so a
   pure-usage error costs no network call.
2. Build the Slack query from `parts: string[] = query ? [query] : []` so a filters-only search sends
   the modifier expression alone; everything downstream (sweep, `query:` header, empty-state) already
   works with a modifier-only string.
3. Update `SEARCH_HELP` usage/blurb/example, `specs/commands/search.md`, `README.md`, and
   `skills/slack-axi/SKILL.md` to document filters-only search.
4. **`test/search.test.ts`**: cover the guard — no-query+no-filter → `USAGE`; `--type`-only → `USAGE`;
   `--in`/`--from` alone clears the guard and reaches auth (`NO_TOKEN` in a token-less env); `--help`
   documents the behavior.

## Validation

- [x] `search` with no query and no filter errors `USAGE`, naming both ways to search. (Unit-tested.)
- [x] `search --type im` (post-filter only, no query) errors `USAGE` — `--type` doesn't stand in for a
      query. (Unit-tested.)
- [x] `search --in #eng` / `search --from alice` (no query) clears the query guard and proceeds to auth;
      the sent query is the modifier expression alone. (Unit-tested: reaches `NO_TOKEN`, not `USAGE`.)
- [x] `search --help` and the spec/README/SKILL document filters-only search. (Unit-tested for `--help`.)
- [x] `bun test` green (62 pass); `bun run typecheck`, `bun run lint`, `bun run format:check`, and
      `bun run build` all clean.

## Risks / unknowns

- **An empty modifier expression** would make Slack reject the query. Prevented by construction: the
  only way to reach the sweep with no free text is via a narrowing filter, which always contributes at
  least one modifier. `--type` (the one non-modifier filter) is excluded from the guard, so it can't
  produce an empty query.

## Notes

## Follow-ups
