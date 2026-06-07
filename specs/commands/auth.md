# Command: auth

Manage Slack workspaces and their user tokens. Token model, resolution order, multi-workspace storage,
and write-protection are specified in
[behaviors/auth-and-workspaces.md](../behaviors/auth-and-workspaces.md); this spec covers the command
surface.

## Subcommands

### `auth setup`

Progressive, agent-guided BYO-app flow (parallels gws-axi's setup). Emits Slack API deep-links and the
exact User Token Scopes to add, tracking progress in `workspaces/<team>/app.json`. Steps:

1. Create a Slack app (deep-link to api.slack.com/apps) — manual.
2. Add the required **User Token Scopes** (listed verbatim, copy-pasteable).
3. Install the app to the workspace → Slack issues the `xoxp-` token.
4. `slack-axi auth login --token xoxp-…` to store it (auto-confirms steps 1–3).

No OAuth loopback / no `--no-wait`/`--wait` split — the user pastes a token, which is simpler than
gws-axi's loopback. Re-runnable; shows the next incomplete step each time.

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
