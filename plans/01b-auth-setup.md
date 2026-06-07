---
status: in-progress
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
- [ ] End-to-end dogfood: paste manifest → create app → install → `auth login` with the real token →
      `setup` reports `complete` → `doctor` passes. *(pending the user's Jarvus app/token.)*

## Risks / unknowns

- Slack "Create from manifest" is a paste flow; no reliable GET-param prefill, so `setup.html` provides
  a copy box rather than a deep-linked prefill. Confirm the manifest imports cleanly in the real UI
  during dogfood.
- Installing a user-token-only app to its own workspace should need no redirect URL; verify during
  dogfood (add a placeholder redirect to the manifest if Slack requires one).

## Notes

(populated at closeout)

## Follow-ups

(populated at closeout)
