# Behavior: Auth tokens and workspaces

## Rule

slack-axi authenticates with a long-lived **user token (`xoxp-`)** per workspace, stored once.
Token resolution is non-interactive (env or stored config), so headless/cron/subagent runs work
identically to interactive ones. Multiple workspaces are supported; a write to the wrong workspace is
prevented by explicit selection.

## Applies To

Every command (all need a token + active workspace). Implemented in `config.ts` (resolution, storage)
and `slack/client.ts` (WebClient per team).

## Details

### Token type and scopes

- User token (`xoxp-`) — required because `search:read` is user-token-only and reading the user's
  private channels / group DMs / DMs requires acting as the user.
- Scopes: `channels:read groups:read im:read mpim:read channels:history groups:history im:history
  mpim:history search:read users:read reactions:read` + `reactions:write chat:write`.
- `doctor` compares granted scopes (from `auth.test`/stored metadata) against this required set and
  reports any gap with the exact missing scope.

### Token resolution order

1. `SLACK_AXI_TOKEN` env (with `SLACK_AXI_TEAM` to select workspace when ambiguous). **No interactive
   step** — this is what makes cron/headless/dispatched-subagent runs work. See
   [principles.md → Stateless, unattended-safe](../principles.md#stateless-unattended-safe).
2. `--team <id>` flag → that workspace's stored `token.json`.
3. Default workspace (`config.json` → `default_team`) → its `token.json`.
4. If exactly one workspace is stored, use it. If none, error `NO_TOKEN` with the setup suggestion.

### Multi-workspace

- One app/token per workspace (team), stored at `workspaces/<TEAM_ID>/token.json` (mode 0600). Only the
  Jarvus workspace is confirmed in current use, but the model supports many from day one (mirrors
  gws-axi multi-account).
- The active workspace is shown in every command's output header (`workspace: Jarvus (T01ABC) as
  @chris`) so the agent always knows which one it's acting against.
- `auth use <team>` sets the default; `auth workspaces` lists all with the default marked.

### Write-protection

- When 2+ workspaces are stored, a **mutating** command (`react`, `draft send`) requires the workspace
  to be explicit (`--team` or `SLACK_AXI_TEAM`); it will not silently fall back to the default. Reads
  fall back to the default freely. Mirrors gws-axi's multi-account write-protection.

### No rotation/refresh machinery (v1)

User tokens don't expire unless the workspace enables token rotation. v1 stores a static token; if a
workspace enforces rotation, that surfaces as `AUTH_INVALID` with a re-login suggestion. Rotation
support is a documented future addition, not v1 scope.

## Principles

**Inherited:**

- [Stateless, unattended-safe](../principles.md#stateless-unattended-safe) — this behavior is its
  primary operationalization (env-first resolution, no interactive auth, no session).
- [Writes are safe by default](../principles.md#writes-are-safe-by-default) — the multi-workspace
  write-protection rule extends it.
