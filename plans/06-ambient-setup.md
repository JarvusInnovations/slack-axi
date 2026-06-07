---
status: planned
depends: [02-discovery]
specs:
  - specs/commands/setup-hooks.md
issues: []
---

# 06 — Ambient context + skill

## Scope

The ambient-context layer: the SessionStart hook that injects the home view at session start, and the
installable skill generated from the home view. (The `auth setup` flow was pulled forward into plan
`01b-auth-setup` to dogfood app creation; it is no longer part of this plan.) Lands after the home view
exists (plan 02).

## Implements

- `specs/commands/setup-hooks.md` — `setup hooks` via `installSessionStartHooks` (Claude Code, Codex,
  OpenCode), idempotent, path-repair; generated `SKILL.md` (live state stripped, `npx -y slack-axi`
  examples) + `--check` CI guard.

## Approach

- `setup hooks`: reuse `axi-sdk-js` installer with marker `slack-axi`; hook command resolves a
  PATH-verified `slack-axi` else absolute path.
- Skill generation: single source of truth = no-args home content; `--check` fails CI on drift.

## Validation

- [ ] `setup hooks` installs SessionStart hooks for Claude Code / Codex / OpenCode; re-running with the
      same path is a silent no-op; a stale executable path is repaired.
- [ ] Session start injects the compact home view as ambient context.
- [ ] `SKILL.md` is generated from the home view with live state stripped and `npx -y slack-axi …`
      examples; `--check` fails when the committed skill drifts.

## Risks / unknowns

- Codex `config.toml` `[features].hooks = true` may need to be set/verified by the installer — confirm
  against the `axi` skill's integration notes and sibling implementations.

## Notes

(populated at closeout)

## Follow-ups

(populated at closeout)
