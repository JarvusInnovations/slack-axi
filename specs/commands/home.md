# Command: home (no args)

## Invocation

`slack-axi` with no arguments. Also the payload of the SessionStart ambient-context hook (see
[setup-hooks.md](setup-hooks.md)).

## Data Requirements

- Active workspace + authed user (`auth.test` / stored token metadata).
- Unread/mention summary across the user's conversations (cheap counts, not full history).
- A short list of the user's most-active or unread channels (member-scoped, all types).

## Output Rules

Content-first per the `axi` standard — live state, not a manual. Includes the tool's identity line and
a one-sentence description before the live data:

```
bin: ~/.local/bin/slack-axi
description: Read, search, and draft Slack across your workspaces
workspace: Jarvus (T01ABC) as @chris
unreads: 3 channels with mentions
channels[5]{id,name,type,unread}:
  C0A,general,public,0
  C0B,eng,private,2
  G0C,launch-team,mpim,1
help[3]:
  Run `slack-axi read <channel>` to read a channel (threads inlined, last 7d)
  Run `slack-axi search "<query>"` to search across the workspace
  Run `slack-axi channels --all` to list every channel, not just yours
```

- If no token is resolvable: show a setup-oriented home instead (no workspace line; `help[]` points at
  `auth setup` / `auth login`).
- If multiple workspaces: show the active one; `help[]` includes `auth workspaces`.
- Token-budget-minimal — this loads on every session via the hook. Deep data belongs in explicit
  commands.

## Actions

None (read-only view).

## Navigation

`help[]` routes to `read`, `search`, `channels`, and (when relevant) `auth`.

## Principles

**Inherited:**

- [Token-frugal, content-first output](../principles.md#token-frugal-content-first-output) — the home
  view is the strongest instance; it must stay tiny because it loads every session.
