# Command: home (no args)

## Invocation

`slack-axi` with no arguments. Also the payload of the SessionStart ambient-context hook (see
[setup-hooks.md](setup-hooks.md)).

## Data Requirements

- Active workspace + authed user (stored token metadata; no network).
- A **cache-only** count of the user's channels (from `cache/<team>/channels.json`). Home never hits
  the network — it loads on every session via the hook, so it must be instant and offline-safe.

## Output Rules

Content-first per the `axi` standard — live state, not a manual. The SDK prepends the identity header
(`bin:` + `description:`); the command returns the live state below it:

```
bin: ~/.asdf/installs/nodejs/22.22.3/bin/slack-axi
description: Read, search, and draft Slack across your workspaces
status:
  workspace: Acme (T0ABCDEF)
  your_channels: 1564
help[2]:
  Run `slack-axi channels` to list your channels (all types)
  Run `slack-axi doctor` to verify auth + scopes
```

- If no token is resolvable: show a setup-oriented home (no `status` block; `help[]` points at
  `auth setup` / `auth login`).
- If multiple workspaces: show the active one; `help[]` includes `auth workspaces`.
- `your_channels` is shown only when the channel cache is non-empty (i.e. after a first `channels`/
  `cache refresh`). Token-budget-minimal — deep data belongs in explicit commands.

**Deferred in v1 (no cheap source):** the unread/mention summary and a most-active channel list are
omitted — there is no cheap, offline source for unread counts (see
[channels.md](channels.md)). As later plans add `read`/`search`, their suggestions join `help[]`.

## Actions

None (read-only view).

## Navigation

`help[]` routes to `read`, `search`, `channels`, and (when relevant) `auth`.

## Principles

**Inherited:**

- [Token-frugal, content-first output](../principles.md#token-frugal-content-first-output) — the home
  view is the strongest instance; it must stay tiny because it loads every session.
