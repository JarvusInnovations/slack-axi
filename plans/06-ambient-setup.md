---
status: done
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

- [x] `setup hooks` installs SessionStart hooks (via `installSessionStartHooks`, marker `slack-axi`,
      Claude Code / Codex / OpenCode); re-running is idempotent (verified: 1 entry after two runs).
- [x] Session start injects the compact home view as ambient context. *(hook command is the no-args
      home view — workspace + cache-only channel count; verified registered alongside the sibling
      `*-axi` tools in `~/.claude/settings.json`.)*
- [~] Installable `SKILL.md` shipped at `skills/slack-axi/` with trigger-shaped frontmatter, live state
      stripped, and `npx -y slack-axi …` examples. **Auto-generation from the home view + a `--check`
      CI drift guard are deferred** (see Follow-ups) — the committed skill is hand-authored for now,
      matching the siblings (none ship generated skills yet).

## Risks / unknowns

- ~~Codex `config.toml` `[features].hooks`~~ → handled by `axi-sdk-js`'s installer (same path the
  sibling tools use); not separately managed here.

## Notes

`setup hooks` mirrors the sibling pattern (`installSessionStartHooks({ marker, timeoutSeconds, onError })`).
Verified on this machine: slack-axi now appears as a SessionStart hook next to gh-axi/gws-axi/etc., and
re-running stays at a single entry. The home view it injects is cache-only (no network), so it's
instant and offline-safe. Shipped a static installable skill (`skills/slack-axi/SKILL.md`). Committed
to trunk.

## Follow-ups

- **Deferred to a future plan:** generate `SKILL.md` from the no-args home content (single source of
  truth) and add a `--check` build step that fails CI when the committed skill drifts. Low priority;
  the hand-authored skill is accurate as of this commit.
