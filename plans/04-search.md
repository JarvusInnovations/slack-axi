---
status: planned
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

- [ ] `search "<q>"` returns ranked matches with `{channel,author,when,text,permalink}`; total shown.
- [ ] `--in`, `--from`, `--after`, `--before` translate to the correct Slack modifiers and combine.
- [ ] Each match has a working permalink; `--full` returns untruncated text.
- [ ] Zero matches → definitive empty state suggesting broader terms or `read`.
- [ ] First `help[]` suggestion offers the equivalent `read <channel> --from --to` for a window sweep.
- [ ] Requires `search:read`; absent scope → `SCOPE_MISSING` with the exact remediation.

## Risks / unknowns

- `search.messages` ranking/pagination semantics differ from history; keep the "no completeness
  guarantee" framing explicit in output so it's never mistaken for a window sweep.

## Notes

(populated at closeout)

## Follow-ups

(populated at closeout)
