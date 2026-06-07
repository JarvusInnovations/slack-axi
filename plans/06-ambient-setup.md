---
status: planned
depends: [02-discovery]
specs:
  - specs/commands/auth.md
  - specs/commands/setup-hooks.md
issues: []
---

# 06 — Progressive setup + ambient context + skill

## Scope

The onboarding and discovery layer: the `auth setup` progressive BYO-app flow, the SessionStart hook
that injects the home view as ambient context, and the installable skill generated from the home view.
Lands after the home view exists (plan 02).

## Implements

- `specs/commands/auth.md` — `auth setup`: deep-links + verbatim scope list, progress tracked in
  `app.json`, re-runnable, next-incomplete-step output.
- `specs/commands/setup-hooks.md` — `setup hooks` via `installSessionStartHooks` (Claude Code, Codex,
  OpenCode), idempotent, path-repair; generated `SKILL.md` (live state stripped, `npx -y slack-axi`
  examples) + `--check` CI guard.

## Approach

- `auth setup`: stepwise state machine in `app.json`; emit the exact User Token Scopes copy-pasteable;
  final step is `auth login --token` (plan 01) which auto-confirms.
- `setup hooks`: reuse `axi-sdk-js` installer with marker `slack-axi`; hook command resolves a
  PATH-verified `slack-axi` else absolute path.
- Skill generation: single source of truth = no-args home content; `--check` fails CI on drift.

## Validation

- [ ] `auth setup` shows the next incomplete step each run, lists required scopes verbatim, and reaches
      a stored token via `auth login`.
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
