---
status: planned
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

- [ ] `slack-axi` with no token resolvable shows the setup-oriented home (no crash), exit 0.
- [ ] `slack-axi auth login --token <valid xoxp>` stores `workspaces/<team>/token.json` at mode 0600,
      derives team/user/scopes, marks it default if first.
- [ ] `slack-axi auth login --token <invalid>` returns `AUTH_INVALID` (translated, no raw payload),
      exit 1.
- [ ] `SLACK_AXI_TOKEN` env overrides stored token; `SLACK_AXI_TEAM` selects workspace.
- [ ] `slack-axi doctor` reports token ok, scope coverage (names any missing scope), read probe;
      exit 1 only on a `fail`-tier check, exit 0 with warnings.
- [ ] `auth workspaces` lists stored teams with default marked; definitive empty state when none.
- [ ] `auth use <team>` is idempotent (already-default = no-op, exit 0).
- [ ] Output is valid TOON; errors render on stdout with a fixing suggestion.

## Risks / unknowns

- Exact mechanism for reading granted scopes (response header `x-oauth-scopes` vs. storing the set at
  login time) — confirm during impl; store at login as the reliable source.
- `axi-sdk-js` `runAxiCli` context-resolution signature — mirror gh-axi's `resolveContext` usage.

## Notes

(populated at closeout)

## Follow-ups

(populated at closeout)
