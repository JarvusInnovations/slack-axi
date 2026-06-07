# slack-axi — Design

Agent eXperience Interface for Slack. A token-efficient CLI an agent drives over the shell to
discover channels, read history (with threads inlined), search, and post safe drafts — replacing
the flaky claude.ai Slack MCP.

## Why this exists (problems we're fixing)

Catalog of every Slack pain we've actually hit — from the live complaints, the `hq-usage` skill's
hard-won warnings, and structural MCP issues. Each maps to a root cause and a concrete fix. The
throughline: **roughly half of these are date/window-correctness failures** (#3, #4, #7), and they
silently corrupt the HQ journal with wrong-period data. Nail "human dates in → human dates +
permalinks + completeness markers out" and the majority of the documented pain disappears.

| # | Symptom | Root cause | slack-axi fix |
| --- | --- | --- | --- |
| 1 | Constantly logged out | Stateful/rotating session (OAuth-app or browser session) | Store a **long-lived user token (`xoxp-`)** once; Slack user tokens don't expire unless the workspace enables rotation. No session, no daemon. |
| 2 | Interactive OAuth breaks headless/scheduled runs | MCP `authenticate`/`complete_authentication` is interactive; absent in cron/headless | **Token from config or `SLACK_AXI_TOKEN` env** — unattended cron/background HQ catch-ups just work. |
| 3 | **Year-wrong timestamps** (the worst one) — queried 2025 ts meaning 2026, got plausible year-old data | API takes raw epoch `oldest`/`latest`; hand-computing seconds is error-prone and silently "succeeds" | Accept **human date ranges** (`--from 2026-04-23 --to 2026-04-29`, `--since 7d`); convert internally and **echo the resolved range back with explicit year** in the header so the agent sanity-checks at a glance. |
| 4 | Oldest-first pagination gaps — first read silently misses part of the window | Opaque cursors, no completeness signal | **Paginate to completion** for the bounded range, return a **stable documented order**, and emit an explicit **`complete: true/false`** + count marker (no silent caps). |
| 5 | `search` vs `read` confusion — search is unreliable for completeness/chronology | One verb overloaded for "find a thing" and "sweep a window" | Make **`read <channel> --from --to` the obvious primary verb** for windows; keep `search` clearly scoped to "find a thing." |
| 6 | Can't find relevant channels; private channels & group DMs are like pulling teeth | Defaults to public-only listing; agent must guess `types` | `channels` defaults to `users.conversations` across **all** types you belong to (public, private, `mpim` group-DMs, `im` DMs). Don't make the agent pick types. |
| 7 | Old activity masquerades as current | Compounds #3/#4 — no date framing in output | Stamp every message with a **human-readable date/time (Eastern)** and **group output by date**, so period mismatches are obvious. |
| 8 | Channel messages and thread replies read separately; reply chains (where the decision lives) get missed | `conversations.history` and `conversations.replies` are separate calls | `read` **inlines thread replies** by default, nested under their parent, pre-computing `reply_count` — one command, not N+1. |
| 9 | **Permalinks hand-assembled** — agent builds `…/archives/{cid}/p{ts_without_dot}`, error-prone, feeds HQ citations | MCP returns no permalink | Return a **ready-to-use permalink on every message** — drops straight into the HQ `slack_message` source format, no string surgery. |
| 10 | Channel identity: name ↔ id friction | Reads need IDs; humans/HQ think in names; HQ stores `{name, id}` pairs | Accept `#bid-foo`, bare name, **or** the channel id everywhere; resolve internally via cache. |
| 11 | Subagent dispatch fragility — "Bash may not be available", re-specify tool each time | MCP tool presence varies per subagent | A plain CLI is available **wherever Bash is** — one command the agent just runs, no per-subagent tool caveats. |
| 12 | Token-heavy, non-ergonomic JSON output | General MCP verbosity | **TOON/compact output**, raw `ts` retained for citations, contextual-suggestions footer. |

## Non-goals (v1)

- **No daemon / bridge / socket-mode.** Slack's Web API is stateless HTTP. Unlike chrome-devtools-axi
  (stateful browser), slack-axi makes direct API calls per invocation. This is the single biggest
  robustness win — there is no session to expire or go stale.
- **No real-time event stream.** Agents poll on demand; they don't subscribe.
- **No direct/unconfirmed posting in v1.** Writes are reactions + drafts you approve (see Capabilities).

## Decisions (locked)

- **Auth:** Official Slack app + **user token (`xoxp-`)**. Authenticate once. `search:read` is a
  user-token-only scope, so this is also the only model that unlocks workspace search — a core feature.
- **Capabilities:** **Read + safe-draft.** Full read surface; writes limited to reactions and
  message drafts the user approves. No silent sends in v1 (a `send`/`reply` direct-post path is a
  documented future toggle, gated like gws-axi's write-protection).
- **Multi-workspace** from day one (mirrors gws-axi multi-account): one app/token per workspace
  (team), stored separately, default selectable.

## Tech stack (matches sibling AXIs)

- TypeScript (strict, ESM), Node 22+ runtime, **bun** for dev/build per global tooling rules
  (siblings vary between bun and tsx — bun is the house default).
- `bin: { "slack-axi": "dist/bin/slack-axi.js" }`, build = `tsc`, dev = `bun bin/slack-axi.ts`.
- Deps: `axi-sdk-js` (`runAxiCli`, `AxiError`, `exitCodeForError`, `installSessionStartHooks`),
  `@toon-format/toon` (output), and **`@slack/web-api`** (official SDK — gives typed methods,
  built-in tiered rate-limit retry, cursor pagination helpers).

## Config & storage (XDG, mirrors gws-axi)

```
~/.config/slack-axi/
  config.json                      # { default_team: "T123" }
  workspaces/
    T01ABC/                        # one dir per team id
      token.json                   # { team, team_name, user_id, token (xoxp-), scopes[], obtained_at }  mode 0600
      app.json                     # setup progress: app created, scopes added, installed
    cache/
      T01ABC/
        channels.json              # id -> {name,type,is_member,...}  for name<->id resolution
        users.json                 # id -> {name,real_name,display_name}  for inlining names
```

Caches make name↔id resolution and user-name inlining cheap; refreshed lazily (TTL) and via
`slack-axi cache refresh`. This is what lets `read #general` and readable author names work without
the agent issuing extra lookup calls.

## Command surface

`slack-axi` with no args → **home view** (content-first):

```
bin: ~/.local/bin/slack-axi
description: Read, search, and draft Slack across your workspaces
workspace: Jarvus (T01ABC) as @chris
unreads: 3 channels with mentions
channels[5]{id,name,type,unread}:        # most-active / unread first
  C0A,general,public,0
  C0B,eng,private,2
  G0C,launch-team,mpim,1
  ...
help[3]:
  Run `slack-axi read <channel>` to read a channel (threads inlined, last 7d)
  Run `slack-axi search "<query>"` to search across the workspace
  Run `slack-axi channels --all` to list every channel, not just yours
```

### Auth & health

```
slack-axi auth setup                 # progressive: create app -> add user scopes -> install -> paste token
slack-axi auth login --token xoxp-…  # store a token directly (or guided via setup)
slack-axi auth workspaces            # list authed teams + which is default
slack-axi auth use <team>            # set default workspace
slack-axi auth revoke <team>         # delete stored token
slack-axi doctor                     # auth.test probe, scope coverage check, rate-limit headroom
```

`auth setup` parallels gws-axi's BYO-app flow: emit Slack API deep-links + the exact User Token
Scopes to add, then accept the pasted `xoxp-` token. Steps tracked in `app.json`; `--no-wait`/`--wait`
split is unnecessary here (no loopback — user pastes a token), which is simpler than gws-axi's OAuth.

**Headless / cron (#2):** token resolution order is `SLACK_AXI_TOKEN` env (with `SLACK_AXI_TEAM` to
pick workspace) → stored `token.json` for the default/`--team` workspace. Env support means scheduled
HQ catch-ups and background subagents run unattended, with no interactive auth step to stall on.

Required **User Token Scopes**: `channels:read groups:read im:read mpim:read channels:history
groups:history im:history mpim:history search:read users:read reactions:read` (+ `reactions:write
chat:write` for drafts/reactions).

### Discovery (fixes the "can't find channels" pain)

```
slack-axi channels                   # YOUR conversations, ALL types (users.conversations) — the default
slack-axi channels --all             # entire workspace (conversations.list, paginated)
slack-axi channels --type private    # filter; types: public,private,mpim,im
slack-axi search channels <q>        # fuzzy match name/topic/purpose, member channels first
slack-axi dms                        # 1:1 IMs and group DMs (mpim) with resolved participant names
slack-axi members <channel>          # channel members, names resolved
```

Every channel-accepting command resolves `#name`, bare `name`, or `C0…` id via the local cache, so
the agent never has to pre-resolve an id.

### Reading (fixes time-query + thread pains)

```
slack-axi read <channel>             # default: last 7d, threads inlined, names resolved, auto-paginated
slack-axi read <channel> --since 24h
slack-axi read <channel> --from 2026-06-01 --to 2026-06-03
slack-axi read <channel> --limit 200 --threads none|summary|full
slack-axi thread <channel> <ts>      # one thread, full replies
```

- **Human time in, human time out.** `--since 7d|24h|90m`, `--from`/`--to` accept dates or relative
  spans; converted to Slack `oldest`/`latest`. The agent never types an epoch. The header **echoes the
  resolved window back with explicit year** (and Eastern tz) so a year-off mistake (#3) is caught at a
  glance.
- **Auto-pagination to completion** walks cursors until the bounded window is fully covered, in a
  **stable documented order** (chronological), and emits an explicit **`complete: true/false`** marker
  with the count — no silent caps (#4). Kills the MCP's "no messages first pass" / oldest-first-gap bug.
- **Permalink on every message** (#9): a ready-to-use URL, so HQ `slack_message` citations need no
  `p{ts_without_dot}` string surgery. Raw `ts` is also retained for any other citation need.
- **Date framing** (#7): each message carries a human-readable Eastern datetime and output is grouped
  by date, so old-activity-as-current mistakes are obvious.
- **Threads inlined** by default: parent message, then nested `↳` replies. `--threads summary` shows
  `reply_count` + last reply without expanding; `--threads full` expands all.
- **Definitive empty state:** `messages: 0 messages in #eng between 2026-05-30 and 2026-06-06`.

Example:

```
workspace: Jarvus (T01ABC)
channel: #eng (C0B, private)
range: 2026-05-30 → 2026-06-06 (America/New_York)
complete: true
2026-06-05:
  messages[2 of 12]{time,author,text,permalink}:
    09:14,alice,"Shipping the auth fix today",https://jarvus.slack.com/archives/C0B/p1717589640123456
    09:15,bob,"↳ nice, did the token refresh land?",https://jarvus.slack.com/archives/C0B/p1717589700234567
2026-06-06:
  messages[1 of 12]{time,author,text,permalink}:
    08:02,carol,"Standup moved to 10:30",https://jarvus.slack.com/archives/C0B/p1717675320345678
help[2]:
  Run `slack-axi thread #eng 1717.01` to expand a thread
  Widen with `--since 30d` or `--from <date>`
```

### Search (the killer feature — user-token only)

```
slack-axi search "<query>"           # search.messages across the workspace
slack-axi search "deploy" --in #eng --from @alice --after 2026-05-01
```

Returns matches with channel, author, timestamp, permalink, and a truncated preview. Translates
friendly flags into Slack search modifiers (`in:`, `from:`, `after:`, `before:`).

### Writes (read + safe-draft)

```
slack-axi react <channel> <ts> :emoji:        # reactions:write — idempotent (already-reacted = no-op, exit 0)
slack-axi draft <channel> "<text>"            # creates a draft, returns it for approval; does NOT send
slack-axi draft <channel> --reply <ts> "…"    # threaded draft
slack-axi draft send <draft-id>               # explicit, separate confirmation step to actually post
```

Drafts are the write-protection analogue: an agent prepares, a human (or an explicit second command)
sends. A `--allow-send` future flag can collapse this for trusted automation, gated like gws-axi.

## AXI-standard behaviors (applied throughout)

- **Minimal schemas:** lists default to 3–4 columns (`id,name,type,unread` / `ts,author,text`);
  `--fields` adds more (topic, purpose, member_count, permalink).
- **Truncation:** message `text` and channel `purpose` truncated (~500 chars) with total length noted;
  `--full` / detail views for complete content.
- **Pre-computed aggregates:** `messages[12 of 12]`, `channels[5 of 47]`, `reply_count`, unread counts —
  so the agent doesn't paginate to learn "how many".
- **Definitive empty states:** every zero result says so with context (`0 channels match "xyz"`).
- **Idempotent mutations:** re-reacting / re-using a draft is a no-op at exit 0.
- **Structured errors on stdout:** translate Slack `error` codes (`not_in_channel`, `channel_not_found`,
  `invalid_auth`, `missing_scope`, `ratelimited`) into `AxiError` with actionable suggestions
  (e.g. `missing_scope` → "re-run `slack-axi auth setup`; add scope `search:read`"). Never leak raw
  Slack API payloads.
- **Exit codes:** 0 success/no-op, 1 error, 2 usage — via `exitCodeForError`.
- **Contextual `help[]`:** list → suggest read/search; read → suggest expand thread / widen range;
  empty → suggest broaden; error → suggest the exact fix.

## Ambient context & discovery

- **SessionStart hook** via `installSessionStartHooks` from `axi-sdk-js`, installed by
  `slack-axi setup hooks` (idempotent; Claude Code, Codex, OpenCode). Session start shows the compact
  home view: default workspace, unread/mention count, top active channels — token-budget-minimal.
- **Installable skill** (secondary) generated from the no-args home view content, with live state
  stripped and commands rewritten to `npx -y slack-axi …`; `--check` CI step guards staleness.

## Proposed file structure

```
slack-axi/
  bin/slack-axi.ts            # thin shim → src/cli.main()
  src/
    cli.ts                    # runAxiCli({ home, commands, getCommandHelp })
    config.ts                 # XDG paths, team/token/cache helpers, default-team
    commands/
      home.ts
      auth.ts                 # setup / login / workspaces / use / revoke
      doctor.ts
      channels.ts             # channels / search channels / dms / members
      read.ts                 # read + thread (shared time/thread logic)
      search.ts
      write.ts                # react / draft / draft send
      setup.ts                # setup hooks
    slack/
      client.ts               # @slack/web-api factory per team (token injection)
      resolve.ts              # #name|name|id -> channel; user id -> name (cache-backed)
      time.ts                 # "7d"/"24h"/date -> Slack ts (oldest/latest)
      threads.ts              # history+replies merge / inline rendering
      errors.ts               # translateSlackError(code) -> AxiError
    output/
      schema.ts               # FieldDef builders (field, truncated, mapEnum, computed)
      render.ts               # renderListResponse, renderObject, renderHelp
  docs/design.md              # this file
```

## Build order

1. Scaffold (package.json, tsconfig, bin shim, `cli.ts` with `runAxiCli`), `auth login --token` +
   `doctor` (`auth.test`). Proves the token model end-to-end.
2. `channels` (users.conversations, all types) + resolve cache + home view. Fixes discovery pain.
3. `read` with human-time + auto-pagination + inlined threads + name resolution. Fixes the two read pains.
4. `search`, `dms`, `members`, `thread`.
5. Writes: `react`, `draft`, `draft send`.
6. `auth setup` progressive flow, `setup hooks`, skill generation + `--check`.
