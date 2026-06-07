# Command: auth

Manage Slack workspaces and their user tokens. Token model, resolution order, multi-workspace storage,
and write-protection are specified in
[behaviors/auth-and-workspaces.md](../behaviors/auth-and-workspaces.md); this spec covers the command
surface.

## Subcommands

### `auth setup`

Progressive, agent-guided BYO-app flow (parallels gws-axi's setup), built around Slack's **app
manifest** so the user never hand-picks scopes. Re-runnable; each run shows the next incomplete step.

slack-axi generates an app manifest (YAML) pre-filled with the required User Token Scopes and with
`token_rotation_enabled: false` (the design's "authenticate once" guarantee, encoded in the app
itself), writing it to `manifest.yaml` plus a `setup.html` with a one-click new-app link and a
copy-paste manifest box. Both are refreshed on every `setup` run so they track the current app name and
scope set.

Two steps:

1. **`app_created`** (manual) — open `setup.html` (or `https://api.slack.com/apps?new_app=1`), choose
   "From an app manifest", pick the workspace, paste `manifest.yaml`. Confirm with
   `slack-axi auth setup --confirm-step app_created`.
2. **`token_stored`** (derived) — install the app (OAuth & Permissions → Install to Workspace), copy
   the User OAuth Token, and run `slack-axi auth login --token xoxp-…`. A stored workspace token marks
   this step complete; it is never manually confirmed.

A stored token is proof the app exists and is installed, so it **subsumes the `app_created`
waypoint**: once any workspace token is stored, setup reports `complete` and points at `doctor` —
even if the user went straight to `auth login` without confirming `app_created`.

Flags: `--name <name>` (manifest app display name; default `slack-axi`), `--confirm-step app_created`,
`--show-manifest` (echo the YAML inline), `--reset` (clear state, e.g. to onboard another workspace).

No OAuth loopback / no `--no-wait`/`--wait` split — the user pastes a token, which is simpler than
gws-axi's loopback. Progress is tracked in `setup.json` at the config root (global onboarding state —
there is no team id until login). See [architecture.md](../architecture.md) for the storage layout.

### `auth login --token <xoxp-…> [--team <id>]`

Validates the token via `auth.test`, derives `team`, `team_name`, `user_id`, and granted `scopes`,
and writes `workspaces/<TEAM_ID>/token.json` (mode 0600). First stored workspace becomes the default.
On an invalid token → `AUTH_INVALID`. If the token's team mismatches an explicit `--team` → error.

### `auth workspaces`

Lists stored workspaces with team id, name, authed user, and which is default. Definitive empty state
if none stored, pointing at `auth setup`.

### `auth use <team>`

Sets `default_team` in `config.json`. Idempotent (already-default = no-op, exit 0).

### `auth revoke <team>`

Deletes the workspace's stored token + caches. Does not deauthorize the app server-side (suggest doing
that in Slack if desired). Idempotent.

## Output Rules

TOON per [output-format.md](../behaviors/output-format.md). `auth login` returns a confirmation object
(workspace, user, scope-coverage summary) — a self-contained detail view, so no `help[]` unless a
scope gap is detected (then suggest re-adding scopes).

## Principles

**Inherited:**

- [Stateless, unattended-safe](../principles.md#stateless-unattended-safe) — setup must never leave the
  tool dependent on an interactive session; the end state is a stored static token usable headless.
