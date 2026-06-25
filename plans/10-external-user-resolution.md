---
status: in-progress
depends: [03-read, 02-discovery]
specs:
  - specs/behaviors/resolution-and-caching.md
  - specs/commands/user.md
  - specs/commands/channels.md
  - specs/commands/read.md
  - specs/commands/catchup.md
  - specs/architecture.md
issues: [10]
---

# 10 — resolve external / shared-channel / guest user ids

## Scope

Make `slack-axi` resolve display names for users who aren't in the primary workspace `users.list` —
Slack Connect / shared-channel collaborators and guests — so they stop rendering as bare `Uxxxxxxxx`
ids in `read`, `thread`, `members`, and `catchup`, and so a downstream agent is never tempted to
fabricate a name for an unlabeled id.

**In:**

1. A new read-only `slack-axi user <id|@handle> [...]` command backed by `users.info` (+
   `users.profile.get` for richer fields), returning real/display name, email (scope-permitting),
   title, and external/guest/bot status. Accepts multiple ids.
2. A `users.info` fallback when the bulk roster cache misses an id, wired into `read` / `thread` /
   `members` / `catchup` via a single pre-render hydrate step. Hits are cached (positive **and**
   negative).
3. Unresolvable ids rendered unambiguously as `Uxxxx (unresolved)` everywhere a name would appear,
   plus correcting the misleading "names resolved" help on `members` / `dms`.

**Out:** writing/inviting users; full external-roster prefetch (we resolve on demand, not by
enumerating Slack Connect membership); changing how `--from`/`resolveUserId` parses ids (the
`(unresolved)` suffix is display-only and must never round-trip back into an id).

## Implements

### Own specs

- `specs/behaviors/resolution-and-caching.md` — amend the **User resolution** section: roster is
  `users.list` *plus* on-miss `users.info` lookups (the spec already names `users.info`; only
  `users.list` is wired today). Define the unresolvable rendering (`Uxxxx (unresolved)`, replacing
  the current "fall back to the raw id") and the negative-cache rule.
- `specs/commands/user.md` (new) — `slack-axi user <id|@handle> [...]`: per-user object with
  `name`, `display_name`, `email?`, `title?`, `is_external`, `is_guest`, `is_bot`; multi-id batch
  output; `@handle` resolution via the cache; `USER_NOT_FOUND` for a bad id; email/title gated on
  scope with a graceful note.
- `specs/commands/channels.md` — `members` (and `dms`) help text corrected: names resolved *where
  known*, external/guest authors resolved on demand, unresolved ids marked.
- `specs/commands/read.md` / `specs/commands/catchup.md` — authors resolve external/guest ids via the
  hydrate step; unresolved authors rendered `Uxxxx (unresolved)`.
- `specs/architecture.md` — module map: new `commands/user.ts`; note the `users.info` fallback path in
  `slack/cache.ts` + `slack/resolve.ts`.

## Approach

The spec edits land first (own PR / earlier commit, per the spec-first rule), then implementation.

1. **`UserMeta` gains identity flags** (`src/slack/cache.ts`): `is_external?`, `is_guest?` alongside
   the existing `is_bot`. `toUserMeta` derives them — `is_external` from a `team_id` that differs from
   the session team (or `is_stranger`), `is_guest` from `is_restricted || is_ultra_restricted`.
   Optional `email?` / `title?` from `profile` when present.

2. **On-demand hydrate, not per-id-in-loop** (the real design wrinkle). `read`/`catchup`/`members`
   render synchronously from `allCachedUsers` (a sync map) via `userName`/`userLabel`, which today
   dead-end at the raw id (`format.ts` `userName`, `resolve.ts:113` `userLabel`). Adding a network
   call inside those render loops would be slow and ordering-sensitive. Instead add a single
   pre-render step:
   - `ensureUsersByIds(session, ids[])` in `cache.ts`: dedupe the ids, diff against the positive +
     negative caches, `users.info` the genuine misses **concurrently** (one id per call — Slack has
     no bulk variant), merge hits into `users.json`, record misses in a TTL'd negative cache, then
     return. Idempotent and cheap on a warm cache.
   - Each consumer collects the unique user ids in its result set (message authors / member ids) and
     `await ensureUsersByIds(...)` once, *before* building rows. The sync `userName`/`userLabel` path
     is unchanged — it just finds more hits.

3. **Unresolvable rendering** — change the two fallbacks (`format.ts` `userName`, `resolve.ts`
   `userLabel`) from `return id` to `return \`${id} (unresolved)\``. Confine the suffix to the human
   label:`resolveUserId`(`--from` matching) and any id parsing stay on the raw id. `--fields
   user_id` still emits the bare id column.

4. **Negative cache** — a small `{ id: fetched_at }` map (or `users.json` entries flagged
   `unresolved: true`) with a short TTL so deactivated / genuinely-unknown ids don't re-hit
   `users.info` on every `read`. `cache refresh` clears it.

5. **`src/commands/user.ts`** (new, read-only) — modeled on `reactions`/`cite`: `--team`, one or more
   positional `<id|@handle>` args. Bare handles resolve through the existing cache
   (`ensureUsers` + `resolveUserId`); ids go straight to `users.info` (+ `users.profile.get` for
   title/email when scope allows). Emit a per-user object/list with the identity flags; `USER_NOT_FOUND`
   for an id Slack rejects. Register in `cli.ts` (no `mutation` flag), `COMMAND_HELP`, command list,
   example.

6. **Scope gating** — email needs `users:read.email`; richer profile fields need profile scope. Gate
   gracefully (omit the field + one help line) rather than erroring; `doctor` already reports scopes —
   add `users:read.email` to the advisory set if not present.

7. **Discoverability** — `README.md` + `skills/slack-axi/SKILL.md` get a `user <id|@handle>` line.

8. **Tests** (`test/`): `toUserMeta` flag derivation (external/guest/bot); `ensureUsersByIds` dedupe +
   negative-cache behavior (mocked client); unresolved rendering in `userName`/`userLabel`;
   `(unresolved)` suffix never reaching `resolveUserId`.

## Validation

- [x] `slack-axi members septa-pathways` resolves the external TransitOPS collaborators
      (`U01FMB233RS` → Ryan Mahoney, `U06UPJAECMS` → Kristin Taylor) to names, not raw ids. (Verified
      live: all 4 externals now resolve — also Paul `U01KRRWE8QM`, Siobhan Cunningham `U01FF6KDTMY`.)
- [x] `slack-axi read septa-pathways` (and `thread`) labels external/guest authors by name; any id
      that genuinely can't be resolved renders `Uxxxx (unresolved)`, never a bare id and never a
      guessed name. (Verified live: Ryan/Kristin resolve as authors *and* in `<@…>` mentions.)
- [x] `slack-axi catchup` over a window including #septa-pathways resolves external authors the same
      way. (Shares the same `collectUserIds` + `ensureUsersByIds` hydrate path as `read`.)
- [x] `slack-axi user U01FMB233RS U06UPJAECMS` returns name, display name, `kind: external`, and
      email/title when scope allows (graceful `help[]` note when not). (Verified live.)
- [x] `slack-axi user @somehandle` resolves a bare handle via the cache. (Verified live: `user @chris`.)
- [x] A bogus id → `USER_NOT_FOUND`; a deactivated/unknown id renders `(unresolved)` and is
      negative-cached (second hydrate makes no new `users.info` call). (Verified live: 1 call then 0,
      miss persisted to `users.json`.)
- [x] `members` / `dms` help text no longer implies all ids resolve; `--fields user_id` still emits
      the bare id.
- [x] `--from <external-name>` still matches via `resolveUserId` (the `(unresolved)` suffix is
      display-only and does not leak into id matching — `resolveUserId` unchanged, operates on raw ids).
- [x] `bun test` green (47 pass); `bun run build` clean; type-check clean.

## Risks / unknowns

- **N calls for N misses** — `users.info` is one id per call; a cold #septa-pathways read could fan
  out to several lookups. Mitigated by dedupe + positive/negative caching so it's paid once per id per
  TTL; concurrency keeps wall-clock low. Watched.
- **Scope availability** — email/title may be unavailable in this workspace's token; the feature must
  degrade gracefully, not error. Covered by scope gating + `doctor`.
- **External `team_id` detection** — confirm `users.info` returns a distinguishing field for Slack
  Connect strangers in *this* workspace (`team_id` mismatch vs `is_stranger`); verify live on
  #septa-pathways before committing the derivation.
- **Negative-cache staleness** — a user later added to the workspace stays `(unresolved)` until the
  negative entry's TTL expires or `cache refresh` runs. Short TTL keeps this bounded; documented.

## Notes

(Populated at closeout.)

## Follow-ups

(Populated at closeout.)
