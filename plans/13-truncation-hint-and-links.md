---
status: done
depends: [11-file-attachments]
specs:
  - specs/behaviors/output-format.md
  - specs/behaviors/links.md
  - specs/commands/read.md
  - specs/commands/catchup.md
  - specs/architecture.md
issues: [18]
pr: 21
---

# 13 — truncation announces `--full`; URLs and link unfurls are never lost

## Scope

Close the two gaps in #18: (1) a response that truncated text never told the agent about `--full`;
(2) a URL someone shared could be cut by truncation, dropped by `<url|label>` rendering, or live only
in Slack's unfurl `attachments[]`, which nothing surfaced.

**In:** the `--full` hint in `help[]` whenever truncation actually occurred (`read`, `thread`,
`catchup`); `--full` on `catchup`; URL-atomic truncation in the shared `truncate()`; `<url|label>` →
`label (url)` (URL alone when the label is just a display form of it); a `links` column on
`read`/`thread` from `attachments[]` (`title <url>`); a `[+N link(s)]` note on `catchup`.

**Out:** `search` (its flag parsing and help are being rewritten by the open external PR #17 —
touching the same lines now would conflict; a `links` column + `--full` for `search` is filed as a
follow-up to land once #17 merges); reading Block Kit `blocks[]` directly (Slack mirrors them into
`text`); unfurling URLs ourselves (we only surface what Slack already unfurled).

## Implements

- `specs/behaviors/output-format.md` — truncation announces its escape hatch; a URL is atomic.
- `specs/behaviors/links.md` — link rendering in text; `links` column; `[+N link(s)]`; URL never cut.
- `specs/commands/read.md` — `<url|label>` rendering; `links` column; `--full` hint.
- `specs/commands/catchup.md` — `--full`; `[+N link(s)]`; `--full` hint.
- `specs/architecture.md` — `slack/links.ts` in the module map.

## Approach

1. **`src/output.ts`**: `truncate(text, max)` scans `https?://\S+` matches and, when the cut lands
   inside one, moves the cut to that URL's end. Export `TRUNCATION_MARK` and `wasTruncated(rendered)`
   so callers can tell whether a rendered cell was cut without re-measuring, plus `fullHint()` for the
   shared `help[]` line.
2. **`src/slack/format.ts`**: `<url|label>` → `label (url)`, or `url` when `url` contains the label
   once its scheme is stripped (Slack's auto-label of a pasted link).
3. **`src/slack/links.ts`** (new): `LinkMeta {url,title?,service?}`; `toLinkMeta(rawAttachment)` picks
   `title_link ?? from_url ?? original_url` and returns `undefined` for URL-less attachments;
   `summarizeLinks(links)` → `title <url>; …`, de-duplicated by URL. Pure; unit-tested.
4. **`src/slack/threads.ts`**: `Msg.links?: LinkMeta[]` mapped from `raw.attachments`.
5. **`src/commands/read.ts`**: `links` column via `fillUniformColumn`; `--full` hint when any row was
   truncated and `--full` is absent (both `read` and `thread`).
6. **`src/commands/catchup.ts`**: `--full` flag; `[+N link(s)]` note; `--full` hint.
7. README + `skills/slack-axi/SKILL.md`: `links` column, `--full` on catchup.
8. Tests: `test/output.test.ts` (URL-atomic truncate, marker), `test/links.test.ts`
   (`toLinkMeta`/`summarizeLinks`/`toMsg` carries links), `test/format.test.ts` (link rendering).

## Validation

- [x] `truncate()` on text whose 500th char falls inside a URL returns the whole URL, then the marker.
- [x] `formatText("<https://x.y/a|label>")` → `label (https://x.y/a)`;
      `formatText("<https://x.y/a/b|x.y/a/b>")` → `https://x.y/a/b`.
- [x] A message with a gdoc unfurl shows a `links` column entry with the title and the complete URL in
      `read` and `thread`; a view with no unfurls has no `links` column. (Live.)
- [x] `catchup` marks the same message `[+1 link]`. (Live.)
- [x] A `read` whose output truncated any text ends with the `--full` hint; with `--full` neither the
      marker nor the hint appears; a short-message view shows no hint. (Live.)
- [x] `catchup --full` is accepted and un-truncates. (Live.)
- [x] `bun run test`, `typecheck`, `lint`, `format:check` all clean.

## Risks / unknowns

- **Unfurl attachment shapes vary** — Slack has several attachment generations (legacy `fallback`-only,
  link unfurls with `title_link`/`from_url`, app attachments with `blocks`). Mitigated by picking the
  URL from a fallback chain and dropping URL-less entries rather than guessing.
- **URL-atomic truncation can overshoot `max`** — bounded by the URL's length; Slack caps message text,
  so this cannot run away.

## Notes

- **The gdoc elision in #18 was the `<url|label>` rendering, not truncation.** Slack labels a pasted
  long URL with a shortened display form that puts the `…` *mid-label*
  (`docs.google.com/document/d/1Cvq…/edit?usp=sharing`); `formatText` rendered only the label, so
  even `--full` showed a prefix. `formatLink` now matches head+tail around the ellipsis and renders the
  URL alone in that case; a genuinely different label keeps both (`label (url)`).
- **Unfurl attachment shapes seen live** (probe over 60 recent `has:link` matches): Google Meet carries
  `from_url`+`original_url`+`title_link`; GitHub carries `title`+`title_link` only; some entries are
  `fallback`-only with no URL (dropped). The `title_link ?? from_url ?? original_url` chain covers them.
- Google Docs links pasted by users often do **not** unfurl (no `attachments[]`) — the href is still
  recovered from the text via `formatLink`, so the two mechanisms are complementary, not redundant.
- `catchup --full` was added for symmetry even though catchup is "lean by design": opt-in, no cost when
  absent, and the hint rule requires every truncating command to have an escape hatch.

## Follow-ups

- Issue [#22](https://github.com/JarvusInnovations/slack-axi/issues/22) — `search`: `links` column +
  `--full` + hint, once #17 (external PR rewriting search flag parsing) merges.
