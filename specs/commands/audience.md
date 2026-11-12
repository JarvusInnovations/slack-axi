# Command: audience

Report **who can read a conversation**: how it is shared, and what kind of account each member is.
A tool deciding whether a message is going somewhere internal or external needs both halves. The
conversation's sharing flags say whether it reaches another organization at all. The members' account
types say whether guests, other-organization users, bots or deactivated accounts are in the room.
Before this command, getting either meant reading slack-axi's stored token and calling Slack directly.

## Invocation

```
slack-axi audience <channel> [--members] [--max-members <n>] [--team <id>]
```

- `<channel>` is an id (`C…`/`G…`/`D…`), `#name` or bare `name`, resolved like every other channel
  argument (see [resolution-and-caching.md](../behaviors/resolution-and-caching.md)). An id goes
  straight to Slack, so DMs and group DMs work by id.
- `--members` lists every checked member with its flags, in place of the non-full-members list.
- `--max-members <n>` (default **200**) bounds how many members are paged and looked up. Past it the
  command stops paging and says so (see Output Rules). It must be a positive integer.
- Exactly one channel argument. A missing one, a second one, an unknown flag or a bad
  `--max-members` value is a `USAGE` error raised before any Slack call, and the unknown-flag error
  lists this command's valid flags.
- No JSON output mode: no other slack-axi command has one, so this one doesn't either.

## Data Requirements

All live; nothing here is read from or written to the cache, because sharing and guest status are
exactly the facts a stale cache would get wrong.

1. **`auth.test`** — the token's own workspace (`team_id`) and, on Enterprise Grid, its
   `enterprise_id`. No scope needed.
2. **`conversations.info`** with `include_num_members=true` — `id`, `name`, kind (from `is_im`,
   `is_mpim`, `is_private`), `is_member`, `is_shared`, `is_ext_shared`, `is_org_shared`,
   `is_pending_ext_shared`, `num_members` when Slack returns it, and `user` (the other person) for an
   im.
3. **`conversations.members`** — paginated (`limit` 200 per page, `response_metadata.next_cursor`)
   until the bound is reached or the list ends.
4. **`users.info`** — one call per member id (Slack has no bulk form), a few at a time. The fields
   read: `deleted`, `is_bot`, `is_restricted`, `is_ultra_restricted`, `is_stranger`, `team_id`,
   `enterprise_user.enterprise_id`, and the profile name.

Scopes, for user and bot tokens alike: `channels:read` (public channels), `groups:read` (private
channels), `im:read` (DMs), `mpim:read` (group DMs), and `users:read`. All five are already in
slack-axi's required set.

## Member categories

Every checked member falls in exactly **one** category, so the counts add up to `members_checked`.
The first rule that matches wins:

| Category | Rule | `why` text |
| --- | --- | --- |
| `unresolved` | `users.info` answered `user_not_found` / `user_not_visible` | `unresolved (<slack error>)` |
| `deactivated` | `deleted: true` | `deactivated` |
| `external` | `is_stranger: true`, or `team_id` differs from the workspace's **and** the user is not in the same Enterprise org | `other organization (team <id>)` or `stranger` |
| `other_workspace` | `team_id` differs, but `enterprise_user.enterprise_id` equals the token's `enterprise_id` | `same org, other workspace (team <id>)` |
| `bot` | `is_bot: true`, or the id is `USLACKBOT` | `bot` |
| `guest` | `is_ultra_restricted` → single-channel; `is_restricted` → multi-channel | `single-channel guest` / `multi-channel guest` |
| `full` | none of the above | — |

- **External outranks guest and bot.** A guest or bot from another organization is counted as
  `external`, because which organization can read the messages matters more than the account type.
- **`team_id` mismatch is the main external signal.** Slack leaves `is_stranger` false for verified
  Slack Connect members, so `is_stranger` is only a second signal (the same finding as plan 10).
- **`other_workspace` exists only on Enterprise Grid**: a member of a sibling workspace in the same
  org is not another organization, and calling it `external` would misclassify every org-shared
  channel.
- `unresolved` is listed, never silently folded into `full`. A consumer that must be safe should
  treat it as unknown.

## Output Rules

Per [output-format.md](../behaviors/output-format.md). A workspace header, a `conversation` block, an
`audience` summary block, then the non-full-members list.

```
workspace: Acme (T0AAAAAAA)
conversation:
  id: C0BBBBBBB
  name: "#proj-shared"
  kind: channel
  is_member: true
  is_shared: true
  is_ext_shared: true
  is_org_shared: false
  is_pending_ext_shared: false
  num_members: 4
audience:
  members_checked: 4 of 4
  truncated: false
  full: 2
  guests: 0
  external: 1
  other_workspace: 0
  deactivated: 0
  bots: 1
  unresolved: 0
non_full_members[2]{id,name,why}:
  U0CCCCCCC,Pat Partner,other organization (team T0DDDDDDD)
  U0EEEEEEE,Build Bot,bot
help[1]:
  Add `--members` to list every member with its flags
```

- `kind` is `channel | private | im | mpim`. `name` is `#name` for channels, the participants for a
  group DM, and `@<name>` for an im (named from the members' own `users.info` lookups).
- `num_members` appears only when Slack returns it (it does not for an im). `is_member` appears only
  when Slack returns it. For an im, `user` is the other participant's id.
- **Truncation is explicit.** `members_checked` is `<checked> of <total>`. When the list ends within
  the bound, `<total>` is the number actually listed and `truncated: false`. When it does not, the
  command stops paging, `truncated: true`, `<total>` is `num_members` (or `more than <checked>` if
  Slack gave no count), and `help[]` names `--max-members`. A truncated summary never claims to be
  complete.
- **Definitive empty state**: when every checked member is a full member, the list line reads
  `non_full_members: 0 (every checked member is a full member of this workspace)`. A conversation
  with no members reads `members_checked: 0 of 0`.
- `--members` replaces the non-full list with
  `members[N]{id,name,category,team,guest,external,bot,deactivated}`, one row per checked member, sorted
  by category (non-full first) and then name. `guest` is `single`, `multi` or empty.
- Help lines appear only when useful: the `--max-members` hint when truncated, and the `--members` hint
  when there are non-full members and the flag was not passed.

## Errors

Per [errors.md](../behaviors/errors.md), with these distinctions:

- **`CHANNEL_NOT_FOUND`** — `conversations.info` answered `channel_not_found`. Slack gives the same
  answer for a private conversation the token isn't in, so the message says both, and the help names
  `channels` and, for a bot token, inviting the bot.
- **`NOT_IN_CHANNEL`** — the conversation exists but this token can't read its members:
  `conversations.info` answered `not_in_channel`, `no_permission` or `channel_is_limited_access`, or
  `conversations.info` succeeded and then `conversations.members` answered `channel_not_found`,
  `not_in_channel` or `no_permission`. The help says to join the conversation (or invite the bot).
- **`SCOPE_MISSING`** — names the scope. Slack's `needed` field wins; without it, the scope follows
  from the call: `conversations.*` → the read scope for the conversation's kind (by id prefix before
  `conversations.info` has answered), `users.info` → `users:read`. The help says to add it under
  **User** or **Bot** Token Scopes, matching the token, and reinstall.
- Any other Slack error goes through the shared translation table. A `users.info` failure other than
  `user_not_found` / `user_not_visible` / `missing_scope` fails the whole command rather than
  producing a summary that silently skipped someone.

## Actions

None (read-only). No cache writes.

## Principles

**Inherited:**

- [Never silently truncate](../principles.md#never-silently-truncate) — the member bound is reported as
  `members_checked: N of M, truncated: true`, never as a complete answer.
- [Resolve identity for the agent](../principles.md#resolve-identity-for-the-agent) — each member's
  account type is classified here, so the caller never reads raw Slack user flags.
- [One call returns the complete answer](../principles.md#one-call-returns-the-complete-answer) —
  sharing flags and the member breakdown come back together.

**Local:**

- **Unknown is its own answer.** A member whose account can't be read is counted `unresolved`, never
  assumed full; a member-listing failure is an error, never an empty audience.
