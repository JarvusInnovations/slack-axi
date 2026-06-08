---
status: done
depends: [07-catchup]
specs:
  - specs/commands/catchup.md
  - specs/behaviors/time-and-completeness.md
issues: []
---

# 07b — catchup batch planning + half-open window correctness

## Scope

`catchup --every <span>` plan mode (emit batch windows, no fetch) for month+ catch-ups done a week at a
time — plus the underlying fix that makes adjacent windows/batches tile with no gap and no overlap.

## Implements

- `specs/commands/catchup.md` — `--every <span>` plan mode: emits ordered, year-stamped batch ranges +
  a per-batch command (scope echoed), no `conversations.history` calls.
- `specs/behaviors/time-and-completeness.md` — windows are half-open `[oldestMs, endMs)`; the Slack
  `latest` is one microsecond before `endMs` so a message on a boundary lands in exactly one window.

## Approach

- `slack/time.ts`: `ResolvedWindow.latestMs` → exclusive `endMs`; `--to <date>` now binds to the **next**
  day's midnight (exclusive) so the named day is fully covered and tiles with the next batch; added
  `tsExclusiveBefore` (integer-microsecond ts math) and `batchWindows`; `parseSpanMs` gained `w`.
- `slack/threads.ts`: `fetchWindow` passes `latest = tsExclusiveBefore(endMs)`.
- `commands/catchup.ts`: `--every` plan branch + `scopeSuffix`. `read.ts`/`catchup.ts` updated to `endMs`.

## Validation

- [x] `catchup --every 1w` emits non-overlapping date batches (last clipped to `--to`), scope echoed,
      no fetch. *(verified: month → 6 weekly batches.)*
- [x] Adjacent windows are disjoint and lossless — empirically on Acme: week1 ∪ week2 == the single
      two-week read, overlap 0, drops 0.
- [x] Unit tests (14 pass): exclusive `endMs`, `--to` next-midnight binding, `tsExclusiveBefore` (incl.
      second-borrow), `batchWindows` tiling (shared boundary instant, 1µs adjacency), DST spring-forward
      week stays exact, `w` span.
- [x] Fixed a latent single-read drop: end-of-day was `.999` ms (dropping the last sub-ms of a day);
      now the exclusive `endMs` + `−1µs` latest covers through `.999999`.

## Risks / unknowns

- Batches advance by fixed `everyMs` from the window start (instant arithmetic), so tiling is exact
  across DST; a DST transition shifts a boundary's wall-clock by 1h, which can nudge a displayed
  batch date — **coverage is unaffected** (no drop/overlap). Documented in the spec.

## Notes

The exclusive-end model unifies single-read and batch correctness: same `[oldest, end)` semantics
everywhere, `latest = end − 1µs`. Also added `vitest.config.ts` to scope tests to `test/` (vitest was
picking up `bun:test` files in vendored skills under `.claude/` / `.agents/`). Committed to trunk.

## Follow-ups

- None.
