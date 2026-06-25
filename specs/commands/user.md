# Command: user

Look up one or more users by id or `@handle` and report who they are — real/display name, title, and
whether each is **external** (Slack Connect), a **guest**, or a **bot**. This is the direct-lookup
counterpart to the on-demand resolution baked into `read`/`members`/`catchup`; it exists so an agent
can deliberately identify an unfamiliar id (especially a shared-channel collaborator the bulk roster
misses) instead of guessing. See [resolution-and-caching.md](../behaviors/resolution-and-caching.md).

## Invocation

```
slack-axi user <id|@handle> [more...]
```

- Each argument is a user id (`U…`/`W…`) or a bare `@handle`. Multiple are accepted in one call.
- Ids resolve via `users.info` directly (the only path that reaches external/shared-channel members).
- `@handle` resolves through the cached roster (`ensureUsers` + the same exact-match used by
  `--from`); handles only resolve for users present in the roster, so external members are addressed
  by id.

## Data Requirements

- `users.info` for the richest, freshest per-user record (name, display name, title, external/guest
  flags, and email when the token holds `users:read.email`).
- The user cache for resolving bare `@handle` arguments to ids.

## Output Rules

Per [output-format.md](../behaviors/output-format.md). A workspace header, then a
`users[N]{id,name,display_name,kind,...}` list. `kind` is one of `external | guest | bot | member`.
`title` and `email` columns appear only when at least one row carries them (uniform fill — empty
string for rows without — so the compact TOON table is preserved); absent entirely otherwise.

```
workspace: Acme (T01ABC)
users[2]{id,name,display_name,kind,title}:
  U01FMB233RS,Ryan Mahoney,Ryan,external,""
  U024GAV5J,Chris Alfano,chris,member,CEO
help[1]:
  Email needs the `users:read.email` scope (and a user who exposes one)
```

- Email/title are **scope- and exposure-gated**: omitted (with a `help[]` note for email) rather than
  erroring when unavailable.
- **Partial success**: ids that resolve are returned; any that don't are listed in a `help[]`
  `Unresolved:` line. When **none** resolve, exit non-zero with `USER_NOT_FOUND` and a suggestion to
  pass a valid id or a shared `@handle`.

## Actions

None (read-only). Resolution side-effect: caches any newly-resolved users.

## Navigation

Complements `members` / `read` / `catchup`, which resolve ids inline; reach for `user` to interrogate
a single unfamiliar id (e.g. one that rendered `Uxxxx (unresolved)` somewhere).

## Principles

**Inherited:**

- [Resolve identity for the agent](../principles.md#resolve-identity-for-the-agent) — this command is
  the deliberate, single-id form of that resolution, reaching external members the bulk roster misses.
- [One call returns the complete answer](../principles.md#one-call-returns-the-complete-answer) — a
  batch of ids resolves in one invocation, name + status + (when available) title/email together.
