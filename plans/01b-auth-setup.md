---
status: done
depends: [01-scaffold-auth]
specs:
  - specs/commands/auth.md
issues: []
---

# 01b — Guided `auth setup` (manifest-based)

## Scope

The progressive, agent-guided `auth setup` flow, pulled forward from plan 06 so we can dogfood it to
create the real Slack app and obtain a token. Built around Slack's app-manifest feature: slack-axi
generates a manifest with all required user-token scopes pre-filled and `token_rotation_enabled:
false`, plus a `setup.html` for one-click create + copy-paste. Two tracked steps (`app_created`
manual, `token_stored` derived from `auth login`).

## Implements

- `specs/commands/auth.md` — the `auth setup` subcommand: manifest generation, `setup.html`, global
  `setup.json` progress, `--name` / `--confirm-step app_created` / `--show-manifest` / `--reset`.
- `specs/architecture.md` — global setup storage (`setup.json`, `manifest.yaml`, `setup.html`).

## Approach

- `src/auth/setup.ts`: `buildManifest`, `writeManifestFile`, `writeSetupHtmlFile`, setup-state
  read/write, `markAppCreated`, `setupProgress` (derives `token_stored` from `listWorkspaceIds`).
- `src/commands/auth.ts`: `setup()` parses flags, refreshes the generated artifacts every run, and
  renders progress + next-step `help[]`.

## Validation

- [x] Fresh `auth setup` → step `app_created`, writes `manifest.yaml` + `setup.html`, exit 0.
- [x] Generated manifest is valid YAML with all 13 scopes and `token_rotation_enabled: false`.
- [x] `--confirm-step app_created` advances to `token_stored`; re-running stays there.
- [x] `--name` customizes the manifest app name; `--show-manifest` echoes YAML; `--reset` clears state.
- [x] Unknown `--confirm-step` value → structured `USAGE` error.
- [x] End-to-end dogfood: paste manifest → create app → install → `auth login` with the real token →
      `setup` reports `complete` → `doctor` passes. *(done against Acme.)*

## Risks / unknowns

- ~~Manifest import~~ → **resolved**: the generated manifest imported cleanly in the real "Create from
  manifest" UI; all 13 scopes were granted on install.
- ~~Redirect URL for user-token install~~ → **resolved**: no redirect URL was needed to Install to
  Workspace; the manifest as generated is sufficient.

## Notes

Dogfooded successfully against Acme. One UX fix surfaced during dogfood and was folded in: the user
went straight from app creation to `auth login` (skipping `--confirm-step app_created`), so `setup`
wrongly still showed `next_step: app_created`. Fixed `setupProgress` so a stored token subsumes the
`app_created` waypoint and reports `complete` (spec note added to auth.md). Committed to trunk.

## Follow-ups

- None.
