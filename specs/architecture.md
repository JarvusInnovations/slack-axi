# Architecture

Foundational technical decisions for slack-axi. See `principles.md` for the value judgments behind
these and `motivation.md` for the pain-point evidence that motivates them.

## What it is

A CLI an agent drives over the shell to read, search, and safely draft Slack across one or more
workspaces. It replaces the claude.ai Slack MCP. It is an AXI tool (see the `axi` skill): TOON output,
minimal schemas, definitive empty states, structured errors, contextual `help[]`, content-first home.

## Stack

- **Language/runtime:** TypeScript (strict, ESM), Node 22+. **bun** for dev/build per house tooling.
- **Binary:** `bin: { "slack-axi": "dist/bin/slack-axi.js" }`. Build = `tsc`. Dev = `bun bin/slack-axi.ts`.
- **Dependencies:**
  - `axi-sdk-js` — CLI harness (`runAxiCli`), error framework (`AxiError`, `exitCodeForError`),
    session-hook installer (`installSessionStartHooks`). Matches gh-axi/gws-axi.
  - `@toon-format/toon` — output encoding.
  - `@slack/web-api` — official Slack SDK: typed methods, built-in tiered rate-limit retry, cursor
    pagination helpers. The only Slack transport; no hand-rolled HTTP.

## No daemon

Unlike chrome-devtools-axi (stateful browser → persistent bridge), slack-axi makes **direct, stateless
Web API calls per invocation**. No bridge, no PID file, no socket-mode/event stream in v1. This is the
primary robustness decision — there is no session to expire or go stale. See
[principles.md → Stateless, unattended-safe](principles.md#stateless-unattended-safe).

## Auth model

Official Slack app + **long-lived user token (`xoxp-`)**. A user token is required because `search:read`
is user-token-only, and because reading the user's private channels / group DMs / DMs requires acting
as the user. Token resolution and multi-workspace storage are specified in
[behaviors/auth-and-workspaces.md](behaviors/auth-and-workspaces.md).

Required **User Token Scopes**: `channels:read groups:read im:read mpim:read channels:history
groups:history im:history mpim:history search:read users:read reactions:read` plus `reactions:write
chat:write` for reactions and drafts.

## Project structure

```
slack-axi/
  bin/slack-axi.ts            # thin shim → src/cli.main()
  src/
    cli.ts                    # runAxiCli({ home, commands, getCommandHelp, resolveContext })
    config.ts                 # XDG paths, team/token/cache helpers, default-team, env resolution
    commands/
      home.ts  auth.ts  doctor.ts  channels.ts  read.ts  search.ts  write.ts  setup.ts
    slack/
      client.ts               # @slack/web-api WebClient factory per team (token injection)
      resolve.ts              # #name|name|id → channel; user id → name (cache-backed)
      time.ts                 # "7d"/"24h"/date → Slack ts; resolved-range formatting (Eastern, year)
      threads.ts              # history+replies merge + inline rendering
      errors.ts               # translateSlackError(code) → AxiError
    output/
      schema.ts               # FieldDef builders (field, truncated, mapEnum, computed)
      render.ts               # renderListResponse, renderObject, renderHelp
  specs/   docs/   plans/
```

Command dispatch mirrors gh-axi/gws-axi: `cli.ts` calls `runAxiCli` with a `commands` map of
`(args, ctx) => string | Record<string,unknown>` handlers; multi-subcommand commands (`auth`,
`channels`, `draft`) dispatch internally and own their own `--help`.

Active-workspace (team) resolution is **per-command via a shared `resolveActiveToken({teamFlag,
mutation})` helper**, not the SDK's `resolveContext` hook. Rationale: `resolveContext` only receives
the top-level command name, but write-protection is subcommand-aware (`react`/`draft send` mutate;
`read`/`channels` don't) and several commands (`auth login`, `auth setup`) must run with no resolved
team at all. A single helper that each command calls with its own `mutation` flag models this
correctly; `runAxiCli` is used with `TContext = undefined`.

## Storage layout (XDG)

```
~/.config/slack-axi/
  config.json                      # { default_team }
  workspaces/<TEAM_ID>/
    token.json                     # { team, team_name, user_id, token, scopes[], obtained_at }  mode 0600
    app.json                       # setup progress
  cache/<TEAM_ID>/
    channels.json                  # id → {name,type,is_member,topic,...}  + fetched_at (TTL)
    users.json                     # id → {name,real_name,display_name}    + fetched_at (TTL)
```

Caches back identity resolution (see [resolution-and-caching.md](behaviors/resolution-and-caching.md))
and are refreshed lazily on TTL expiry and via `slack-axi cache refresh`.

## Output & errors

All commands return a TOON string. Output rules, schemas, truncation, aggregates, and empty states are
specified in [behaviors/output-format.md](behaviors/output-format.md). Slack API errors are translated
to `AxiError` with actionable suggestions per [behaviors/errors.md](behaviors/errors.md). Exit codes:
0 success/no-op, 1 error, 2 usage.

## Out of scope (v1)

Real-time events / socket mode; direct unconfirmed posting; channel/conversation creation; admin APIs;
file uploads. Canvas/file *reading* may be added later but is not in the initial surface.
