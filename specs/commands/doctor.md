# Command: doctor

Health check: confirms the active workspace's token works, scopes cover the required set, and reports
rate-limit headroom. The first thing to run when something's off.

## Invocation

`slack-axi doctor [--team <id>]`

## Data Requirements

- `auth.test` on the resolved token (validates auth, returns team + user + url).
- Granted scopes (from the `auth.test` response headers / stored metadata) vs. the required scope set
  in [auth-and-workspaces.md](../behaviors/auth-and-workspaces.md).
- A cheap probe call (e.g. `users.conversations` limit 1) to confirm read access end-to-end.

## Output Rules

Tiered checks, each `ok`/`warn`/`fail`:

```
workspace: Jarvus (T01ABC) as @chris
checks[4]{check,status,detail}:
  token,ok,auth.test passed
  scopes,warn,missing search:read
  read_probe,ok,users.conversations reachable
  rate_limit,ok,no recent 429s
help[1]:
  Re-run `slack-axi auth setup` to add scope `search:read`, then re-install the app
```

- Exit code 1 if any check is `fail`; warnings keep exit 0 (for CI/scripted use).
- A scope gap is `warn` (token works, some features unavailable) and names the exact missing scope.

## Actions

None (read-only diagnostics).

## Principles

**Inherited:**

- [Stateless, unattended-safe](../principles.md#stateless-unattended-safe) — doctor's job is to
  confirm the non-interactive token path is healthy without any interactive step.
