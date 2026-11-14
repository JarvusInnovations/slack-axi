---
status: done
depends: [02-discovery, 10-external-user-resolution]
specs:
  - specs/commands/audience.md
  - specs/behaviors/errors.md
  - specs/architecture.md
issues: []
pr: 40
---

# 17 — `audience`: who can read a conversation

## Scope

A downstream tool classifies where a message is going (internal or external). slack-axi exposes
neither a conversation's sharing flags nor its members' guest/other-organization status, so that tool
reads slack-axi's stored token and calls Slack itself. Give it one read-only command instead.

**In:** `slack-axi audience <channel> [--members] [--max-members <n>] [--team <id>]`, built on
`auth.test` + `conversations.info` + `conversations.members` + `users.info`; exclusive member
categories; explicit truncation at the bound; distinct not-found / not-in-channel / missing-scope
errors; strict flag validation; tests with Slack stubbed; README, skill and help text.

**Out:** a JSON output mode (no other command has one); caching sharing or guest status (they must
be live); changing `members` or `user`; the pre-existing `USAGE` exit code (see Follow-ups).

## Implements

- `specs/commands/audience.md` (new) — the command.
- `specs/behaviors/errors.md` — points at the audience-specific error distinctions.
- `specs/architecture.md` — `commands/audience.ts` in the module map.

## Approach

1. `src/commands/audience.ts`: parse and validate flags before any Slack call (unknown long flag →
   `USAGE` listing the valid flags; exactly one positional; positive-integer `--max-members`).
2. `collectAudience(session, channelId, { maxMembers })` does the Slack calls and returns plain data;
   `renderAudience` turns it into TOON. Tests drive both with a fake session client.
3. `users.info` runs through a small concurrency pool (8 at a time); the SDK's retry handles rate
   limits.
4. Scope errors name the scope from Slack's `needed` field, else from the call and conversation kind;
   `addScopesHelp` gains a bot/user switch so a bot token is pointed at Bot Token Scopes.
5. Register in `cli.ts` (command map, help map, top-level list); README and `skills/slack-axi/SKILL.md`
   get a line.

## Validation

- [x] `bun run lint`, `format:check`, `typecheck`, `build`, `test` all clean (the CI steps; 225 tests).
- [x] Tests cover: a plain internal channel; an externally shared channel; a guest; a member from
      another team; a same-org other-workspace member; an im; pagination across pages; truncation at
      the bound (with and without `num_members`); unresolved users; `--members`; channel-not-found;
      not-in-channel (from `conversations.info` and from `conversations.members`); missing scope from
      `conversations.info` (with `needed`) and from `users.info` (without it); a bot-token scope hint;
      unknown flag, missing channel and bad `--max-members` usage errors raised before any Slack call.
      (30 tests in `test/audience.test.ts`.)
- [x] `slack-axi audience --help` prints the command help; `slack-axi --help` lists `audience`. (Checked on the built
      `dist/bin/slack-axi.js`.)

## Risks / unknowns

- **N `users.info` calls for N members.** Bounded by `--max-members` (default 200) and a concurrency
  pool; the SDK retries rate-limited calls.
- **Enterprise Grid user `team_id`.** The `other_workspace` rule relies on
  `enterprise_user.enterprise_id`; not checked against a live Grid org.

## Follow-ups

- **`USAGE` errors exit 1, not 2.** `axi-sdk-js` maps only `VALIDATION_ERROR` to exit 2, and every
  slack-axi command throws `USAGE`, so the exit-2 rule in `specs/behaviors/errors.md` is not met
  anywhere. `audience` follows the repo convention for now. Tracked as: None (not filed).
