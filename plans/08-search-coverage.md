---
status: done
depends: [04-search]
specs:
  - specs/commands/search.md
  - specs/behaviors/time-and-completeness.md
issues: []
pr: https://github.com/JarvusInnovations/slack-axi/pull/6
---

# 08 — search coverage, efficiency & traceability

## Scope

Make `search` as comprehensive, efficient, and traceable as a personal token allows: sweep ALL matches
by default (not a ranked top-N), cover files as well as messages, expose the modifier set needed to
express a precise query, resolve identities exactly, and stamp every result with its coverage boundary
and completeness so a partial view is never mistaken for the whole workspace.

Closes the correctness gap in 04: `search.messages` was called with `count: limit` and no pagination,
so `--limit > 100` silently returned page 1 while the header printed the full `total` — a violation of
*Never silently truncate*.

## Implements

- `specs/commands/search.md` (rewritten) — exhaustive-by-default page-based sweep + `complete` marker;
  `--files` via `search.files`; `--to`/`--has`/`--is`/`--on`/`--during` modifiers; exact identity
  resolution for `--from`/`--with`/`--to`; `--type` post-filter by cached channel type; the `coverage:`
  header.
- `specs/behaviors/time-and-completeness.md` — search now declares completeness on its query axis.

## Approach

- One page-based paginator (`paginate`) drives both endpoints: both expose `paging:{page,pages,total}`,
  so we loop pages to completion rather than depend on a cursor field the response type doesn't surface.
  `sort: timestamp`, `sort_dir: asc` for stable oldest→newest accumulation; stop at pages-exhausted,
  `--limit`, or a stated 1000-match ceiling.
- Reuse: `resolveUserId` (new, `src/slack/resolve.ts`) over the user cache for exact `<@U…>`;
  `getCachedChannel` for `--type` classification (the `C` prefix can't separate public/private);
  `formatText`/`userName`/`formatDateTime`/`handle` for rows; `takeFlags` (new, `src/flags.ts`) for
  repeatable `--has`/`--is`.
- Plumb `user_id`/`user_name` through `ActiveToken` → `Session` so the `coverage:` line names whose view
  the results reflect.

## Validation

- [x] `search "<term>"` sweeps all matches oldest→newest; header shows `coverage:` + `complete: true`
      when fully retrieved. *(verified: "kubernetes deployment" → matches[213], complete: true.)*
- [x] A high-volume term returns the true total via pagination (not capped at 100); `--limit` →
      `complete: false` + "raise `--limit`" help. *(verified: "proposal" → 4835 total, --limit 5 shows
      `5 of 4835`, complete: false.)*
- [x] `--files` returns file hits `{title,type,author,when,id,permalink}`; covered by `search:read`
      (not `files:read`) — confirmed live; `search.files` honors `in:`/`from:`. *(verified: a token with
      only `search:read` returned files and honored `from:<@U…>` and `in:#general`.)*
- [x] `--from <bareName>` resolves to an exact `<@U…>`; modifiers compose into the query.
      *(verified: `--from chris` → `from:<@U024GAV5J>`; `--is thread --has link` → `has:link is:thread`.)*
- [x] `--type` post-filters by true channel type and reports kept-of-retrieved. *(verified:
      `--type public` kept 91 of 120 — and this workspace gives mpims a `C` prefix, so the cache-backed
      classifier, not a prefix heuristic, is what makes this correct.)*
- [x] `bun run test` green (existing + new `test/search.test.ts`). *(29 vitest cases pass.)*

## Risks / unknowns

- ~~`search.files` modifier support~~ → **resolved**: confirmed live that `search.files` is covered by
  `search:read` (NOT `files:read`) and honors `from:`/`in:`. The planned `files:read` scope addition was
  dropped — it would force a needless re-install and a perpetual `doctor` warning.
- ~~Conversation-type classification~~ → **resolved**: this workspace assigns `C` prefixes to mpims, so
  a prefix heuristic would misclassify them. The implementation classifies via the cached channel
  `type` instead, validated live (`--type public` kept 91 of 120).
- `--type` is a post-filter, so its count is "kept of retrieved," not a query narrowing — output says so.

## Notes

Verified end-to-end on the Jarvus workspace. Live testing caught two things static analysis didn't:
(1) `search.files` needs only `search:read`, so the planned `files:read` scope was dropped before it
could force a needless re-install; (2) this workspace prefixes mpims with `C`, vindicating the
cache-backed `--type` classifier over a prefix heuristic. Personal-token ceiling is unchanged by design;
the `coverage:` line surfaces that boundary on every result. Broader workspace-wide collection
(org-owner/admin authority) is out of scope for this public tool.

## Follow-ups

- Observed: a `--type` post-filter combined with a small `--limit` can yield 0 after filtering (the
  limit is spent on retrieval, before the filter). Acceptable and reported honestly ("kept 0 of N
  retrieved"); revisit only if a "retrieve until N of the requested type" mode proves needed.
