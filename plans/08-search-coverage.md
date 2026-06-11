---
status: in-progress
depends: [04-search]
specs:
  - specs/commands/search.md
  - specs/behaviors/time-and-completeness.md
issues: []
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
- `files:read` scope (`src/slack/scopes.ts`) → manifest + doctor coverage.

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

- [ ] `search "<term>"` sweeps all matches oldest→newest; header shows `coverage:` + `complete: true`
      when fully retrieved.
- [ ] A high-volume term returns `matches[N of N]` reflecting the true total via pagination (not capped
      at 100); `--limit 50` → `complete: false` + "raise `--limit`" help.
- [ ] `--files` returns file hits `{title,type,author,when,id,permalink}`; absent `files:read` →
      `SCOPE_MISSING` naming the scope. Confirm `search.files` honors `in:`/`from:` empirically.
- [ ] `--to @user`, `--has link`, `--is thread`, `--on <date>`, `--during <month>` each shape the query;
      `--from <bareName>` resolves to an exact `<@U…>`; ambiguous/no match → fuzzy fallback + note.
- [ ] `--type im|private|public|mpim` post-filters by true channel type and reports kept-of-retrieved.
- [ ] `doctor` flags `files:read` missing until re-install, then green.
- [ ] `bun run test` green (existing + new `test/search.test.ts`).

## Risks / unknowns

- `search.files` modifier support (does it honor `in:`/`from:`/`with:`?) — confirm live; adjust help if
  any modifier is ignored.
- `--type` is a post-filter, so its count is "kept of retrieved," not a query narrowing — output must
  (and does) say so to stay honest.

## Notes

Personal-token ceiling is unchanged by design: search sees only conversations the authenticated user
belongs to. The `coverage:` line surfaces that boundary on every result rather than papering over it.
Broader workspace-wide collection (org-owner/admin authority) is out of scope for this public tool.

## Follow-ups

- TBD at closeout.
