---
status: done
depends: []
specs:
  - specs/architecture.md
  - specs/commands/auth.md
  - specs/commands/doctor.md
  - specs/behaviors/auth-and-workspaces.md
  - specs/behaviors/errors.md
  - specs/behaviors/output-format.md
issues: []
---

# 01 — Scaffold + auth + doctor

## Scope

Stand up the project and prove the token model end-to-end. Repo scaffold (package.json, tsconfig, bin
shim), the `runAxiCli` dispatcher, config/storage helpers, the output layer (`render.ts`/`schema.ts`),
the Slack `WebClient` factory, error translation, and the two commands that validate auth: `auth
login --token` and `doctor`. Also `auth workspaces`/`use`/`revoke`.

## Implements

- `specs/architecture.md` — stack, project structure, storage layout, no-daemon decision.
- `specs/behaviors/auth-and-workspaces.md` — token type/scopes, resolution order (env → flag →
  default → single), multi-workspace storage, write-protection scaffolding.
- `specs/commands/auth.md` — `login`, `workspaces`, `use`, `revoke` (not `setup` — that's plan 06).
- `specs/commands/doctor.md` — `auth.test` probe, scope-coverage check, read probe.
- `specs/behaviors/errors.md` — `translateSlackError`, `AxiError`, exit codes.
- `specs/behaviors/output-format.md` — `render.ts`/`schema.ts` foundation (TOON, empty states, help[]).

## Approach

- Match sibling AXIs: TypeScript/ESM, `bun` dev/build, deps `axi-sdk-js` + `@toon-format/toon` +
  `@slack/web-api`. Use package-manager commands (`bun add`), commit lockfile.
- `config.ts`: XDG paths, `token.json`/`config.json` read/write, env resolution, `listWorkspaces`,
  `resolveTeam({mutation})`.
- `slack/client.ts`: `webClientForTeam(team)` injecting the stored/env token.
- `slack/errors.ts`: code→AxiError table from the errors spec.
- `auth login`: `auth.test` → derive team/user/scopes → write `token.json` (0600); first = default.

## Validation

- [x] `slack-axi` with no token resolvable shows the setup-oriented home (no crash), exit 0.
- [x] `slack-axi auth login --token <valid xoxp>` stores `workspaces/<team>/token.json` at mode 0600,
      derives team/user/scopes, marks it default if first. *(verified: Acme T0ABCDEF stored, default.)*
- [x] `slack-axi auth login --token <invalid>` returns `AUTH_INVALID` (translated, no raw payload),
      exit 1. *(verified against live auth.test.)*
- [x] `SLACK_AXI_TOKEN` env overrides stored token; `SLACK_AXI_TEAM` selects workspace.
- [x] `slack-axi doctor` reports token ok, scope coverage (names any missing scope), read probe;
      exit 1 only on a `fail`-tier check, exit 0 with warnings. *(verified all-green against Acme:
      token ok, all 13 scopes granted, users.conversations reachable.)*
- [x] `auth workspaces` lists stored teams with default marked; definitive empty state when none.
- [x] `auth use <team>` is idempotent (already-default = no-op, exit 0).
- [x] Output is valid TOON; errors render on stdout with a fixing suggestion.

## Risks / unknowns

- ~~Reading granted scopes~~ → **resolved**: `validateToken` does a direct `fetch` to `auth.test` and
  reads the `x-oauth-scopes` response header (the SDK WebClient doesn't surface headers cleanly), giving
  body + scopes in one call. Stored at login; doctor re-reads live.
- ~~`runAxiCli` context resolution~~ → **resolved**: `resolveContext` only sees the top-level command,
  but write-protection is subcommand-aware, so team resolution is per-command via `resolveActiveToken`
  (not the context hook). `renderHomeHeader`/output helpers are NOT re-exported from `axi-sdk-js` (only
  cli/errors/hooks are) — the SDK auto-prepends the home `bin:`/`description:` header, so commands must
  not render their own.

## Notes

Verified end-to-end against a real workspace (team `T0ABCDEF`): `auth login` stored
the token, `doctor` is all-green with all 13 scopes granted. Slack issued every requested user scope on
first install. No PR — committed to trunk (commits `0b23d0d`, `7d58ac2`). `slack-axi` is `npm link`ed
to the repo and on PATH via the asdf node shim.

Key SDK findings recorded for downstream plans: `axi-sdk-js` re-exports only `cli`/`errors`/`hooks`
(output/home-header helpers are internal; the SDK auto-prepends the home header); team resolution is
per-command (`resolveActiveToken`), not via `resolveContext`.

## Follow-ups

- None. (Granted-scope discovery and context-resolution unknowns were resolved in-plan; see Risks.)
