---
status: done
depends: [03-read]
specs:
  - specs/behaviors/reactions.md
  - specs/commands/reactions.md
  - specs/commands/read.md
  - specs/architecture.md
issues: []
pr: https://github.com/JarvusInnovations/slack-axi/pull/8
---

# 09 — emoji reactions: inline counts + full reactor roster

## Scope

Let an agent (1) see reactions while reading a channel and (2) get the complete list of who reacted
with each emoji.

**In:** inline counts-only reaction summary on `read`/`thread` (auto-when-present, no extra API call);
a new read-only `reactions <channel> <ts>` command serving the complete identity-resolved roster from
`reactions.get full=true`.

**Out:** bulk add/remove of reactions (the existing `react` write verb covers single adds); reaction
data in `search`/`catchup` output (search already has the `--has reaction` *filter* — surfacing
reaction *counts* in those views is a possible follow-up, not this change).

## Implements

### Own specs

- `specs/behaviors/reactions.md` — the count-authoritative / roster-truncated split; inline = counts
  only (auto-when-present, uniform column), names only from `reactions.get full=true`; emoji naming
  (colons, skin-tone preserved); identity resolution.
- `specs/commands/reactions.md` — `slack-axi reactions <channel> <ts>`: header (workspace, channel,
  reacted message + permalink), `reactions[N]{emoji,count,users}` count-desc, `complete: true`, empty
  state, `MESSAGE_NOT_FOUND`.
- `specs/commands/read.md` — inline counts-only `reactions` column on `read`/`thread`; `help[]` +
  Navigation pointer to `reactions`.
- `specs/architecture.md` — `slack/reactions.ts` + `commands/reactions.ts` in the module map.

## Approach

1. **`src/slack/reactions.ts`** (new): `Reaction`/`ReactedMessage` interfaces; `fetchReactions` (calls
   `reactions.get full=true`, normalizes `res.message`, `null` when absent); `summarizeReactions`
   (pure → `:heart:×12 :eyes:×3`, native order); `orderReactions` (pure, count-desc, stable tie-break)
   — the last two are the unit-tested seams.
2. **`src/slack/threads.ts`**: extend `Msg` with `reactions?: { name; count }[]`; copy `raw.reactions`
   in `toMsg` (counts only — deliberately drop the truncated embedded `users`). `fetchWindow` /
   `fetchReplies` carry it through unchanged.
3. **`src/commands/read.ts`**: in `buildRow` compute the summary; track `anyReactions` across all rows
   (parents + inlined replies); when true, set `reactions` (summary or `""`) on **every** row as a
   uniform trailing column; add the `reactions <ch> <ts>` `help[]` line. `thread` gets the same over
   its rows.
4. **`src/commands/reactions.ts`** (new): modeled on `cite`/`thread` — `--team`, positional
   `<channel> <ts>`, `dottedTs`, `resolveChannel`, `channelLabel`, `ensureUsers`/`allCachedUsers`,
   `userName`, `getPermalink`; count-desc order; empty + not-found states.
5. **`src/cli.ts`**: register read-only `reactions` (no `mutation` flag), `COMMAND_HELP`, command-list
   line, example.
6. **Discoverability**: `README.md` + `skills/slack-axi/SKILL.md` get a `reactions <channel> <ts>` line.
7. **`test/reactions.test.ts`** (new): `summarizeReactions` (basic, empty, skin-tone preserved);
   `orderReactions` (count-desc + tie-break).

## Validation

- [x] `read` over a window containing reactions shows a uniform counts-only `reactions` column
      (`:emoji:×N`); a reaction-free window shows **no** column. (Verified live on #general: column
      present with empty `""` rows in a mixed window; absent entirely in a join-only window.)
- [x] `thread` on a thread whose messages carry reactions shows the same uniform inline column.
- [x] `reactions <channel> <ts>` returns `reactions[N]{emoji,count,users}` count-desc, reactor ids
      resolved to names, `complete: true`, with the reacted message + permalink in the header.
- [x] A message verified to have a >1-reactor emoji lists all reactor names (sourced from
      `reactions.get full=true`, not the truncated embed). (14 names on `:orange_heart:`.)
- [x] Reaction-free message → definitive empty state, exit 0; bogus ts → `MESSAGE_NOT_FOUND`.
- [x] Skin-tone variant rendered verbatim (`:+1::skin-tone-3:`) and counted distinctly.
- [x] `bun test` green (37 pass); `bun run build` clean; type-check clean.

## Risks / unknowns

- **Per-message roster cost** — `reactions.get` is one call per message; acceptable because it's only
  paid when an agent explicitly asks for the roster (inline counts stay free). Watched, not mitigated.
- **External/deactivated reactors** — ids not in the user cache fall back to raw id (same rule as
  authors); `ensureUsers` is already loaded, so no per-reactor lookup.

## Notes

- **The truncation is the whole design.** `conversations.history` embeds a per-reaction `users` array
  but Slack documents it "might not always contain all users"; `count` is always the true total. Only
  `reactions.get full=true` "always return[s] the complete reaction list." Verified live (max reactor
  count in this workspace was 14, where both sources agreed — the cap is higher, but the docs are
  unambiguous and the design follows them). This is why inline = counts-only and names live behind a
  dedicated per-message call.
- **TOON uniformity is load-bearing.** A row key present on only some rows collapses the compact
  `messages[N]{cols}:` table into verbose per-field YAML. `fillReactionColumn` enforces all-or-nothing:
  the column is added only when some row has reactions, then set (empty `""`) on every row.
- **`react` vs `reactions`** dispatch by exact match in the AXI SDK (`options.commands[command]`), so the
  shared prefix is unambiguous — no aliasing needed.
- Skin-tone/modifier variants (`+1::skin-tone-3`) are distinct reactions in Slack and are preserved
  verbatim and counted separately, confirmed live.

## Follow-ups

- **Reaction counts in `search`/`catchup` views** — `search` already supports the `--has reaction`
  *filter*, but neither view surfaces reaction *counts* in output. Possible enhancement, not needed for
  this capability. Tracked as: None (no issue filed; noted here and in `specs/commands/reactions.md`
  out-of-scope). Revisit if an agent workflow wants reaction signal in a sweep.
