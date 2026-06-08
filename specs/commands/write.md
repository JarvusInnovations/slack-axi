# Command: write (react, draft, draft send)

The only mutations in v1. Safe by default: reactions, and message **drafts** the user approves. No
unconfirmed direct posting. See
[principles.md → Writes are safe by default](../principles.md#writes-are-safe-by-default).

## Subcommands

### `react <channel> <ts> :emoji:`

Adds a reaction (`reactions.write`). Idempotent — already present → `no-op`, exit 0 (see
[errors.md](../behaviors/errors.md)). Returns a confirmation object (no `help[]`).

### `draft <channel> "<text>" [--reply <ts>]`

Creates a **draft** and returns it for approval. Does **not** send. `--reply <ts>` makes it a threaded
draft. The draft is persisted with an id and echoed back in full (the exact text + target) so a human
or the agent can verify before sending.

```
draft:
  id: d_01H…
  workspace: Acme (T01ABC)
  channel: #eng (C0B)
  reply_to: 1717589640.123456
  text: "Confirmed — the refresh landed in 4.8."
help[1]:
  Run `slack-axi draft send d_01H…` to post it
```

### `draft send <draft-id>`

The explicit, separate confirmation step that actually posts (`chat.postMessage`). Returns the posted
message's permalink + ts. Idempotent — already-sent → acknowledges prior send, exit 0. Subject to
multi-workspace write-protection (see
[auth-and-workspaces.md](../behaviors/auth-and-workspaces.md)).

### `draft list` / `draft discard <id>`

List pending drafts; discard one. Drafts are stored locally as `~/.config/slack-axi/drafts/<id>.json`
(each records its `team`, so `draft send` posts to the workspace the draft was created against, which
also satisfies multi-workspace write-protection). `draft send` marks the draft `sent` (with the posted
ts + permalink) rather than deleting it, so re-sending is an idempotent no-op.

## Data Requirements

`reactions.add`, `chat.postMessage`. Channel/ts resolution per
[resolution-and-caching.md](../behaviors/resolution-and-caching.md).

## Output Rules

Per [output-format.md](../behaviors/output-format.md). Mutations return confirmation objects; `draft`
(prepare) includes the `draft send` next-step in `help[]`; `react`/`draft send` confirmations are
self-contained (no `help[]`).

## Future (not v1)

A `--allow-send` opt-in could collapse draft→send for trusted automation, gated like gws-axi's
write-protection. Out of v1 scope; documented so the draft model is understood as deliberate, not a
limitation to route around.

## Principles

**Inherited:**

- [Writes are safe by default](../principles.md#writes-are-safe-by-default) — the prepare/approve split
  and idempotency are its operationalization.
