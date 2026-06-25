---
name: slack-axi
description: Read, search, and cite Slack from the shell. Use when asked to read or summarize a Slack channel, find a discussion across Slack, look up private channels / group DMs / DMs, read a channel over a date range, follow a thread, or produce permalink citations for Slack messages. Token-efficient TOON output; human date ranges in, permalinks out.
---

# slack-axi

A CLI for reading, searching, and citing Slack with agent-ergonomic (TOON) output. Replaces the
flaky Slack MCP: a stored user token (no logouts, works headless), all conversation types discoverable,
human date windows (no epoch math), threads inlined, and permalinks on demand.

Run commands with `npx -y slack-axi <command>` (or `slack-axi` if installed on PATH). Channel
arguments accept `#name`, bare `name`, or an id (`C…`/`G…`/`D…`) interchangeably.

## Orient

- `npx -y slack-axi` — home: active workspace + your channel count.
- `npx -y slack-axi doctor` — verify the token works and scopes are covered.

## Find channels (incl. private channels, group DMs, DMs)

- `npx -y slack-axi channels` — your conversations across ALL types (capped; use `--match`/`--type`).
- `npx -y slack-axi channels --match proj` — fuzzy-find by name.
- `npx -y slack-axi channels --type private` — filter (public|private|mpim|im); `--all` for the whole workspace.
- `npx -y slack-axi dms` — DMs and group DMs with participants.
- `npx -y slack-axi members <channel>` — channel members; external/shared-channel and guest names resolved on demand, unresolvable ids shown as `Uxxxx (unresolved)`.
- `npx -y slack-axi user <id|@handle> [...]` — look up users by id or handle: real/display name and whether each is external (Slack Connect), a guest, or a bot. Resolves shared-channel members the roster misses.

## Read a channel over a time window (the primary verb)

- `npx -y slack-axi read <channel>` — last 7 days, thread replies inlined, names resolved.
- `npx -y slack-axi read <channel> --from 2026-04-23 --to 2026-04-29` — explicit window (human dates).
- `npx -y slack-axi read <channel> --since 24h` — relative span (`90m`, `24h`, `7d`).
- Flags: `--threads full|summary|none`, `--limit <n>`, `--exclude-bots`, `--tz <zone>`, `--cite`, `--full`.
- The output header echoes the resolved range **with explicit year + timezone** (sanity-check the year),
  a `complete: true|false` marker, and a top-level `messages: N of M` count — coverage is never silently
  partial.
- `npx -y slack-axi thread <channel> <ts>` — read one thread fully.
- `read`/`thread` show a counts-only `reactions` column (`:emoji:×N`) when any message in view has
  reactions — free, already in the data. For **who** reacted, use the `reactions` command below.

## Reactions (who reacted)

- `npx -y slack-axi reactions <channel> <ts>` — every emoji on a message + the complete, name-resolved
  roster of who reacted (count-desc). Sourced from `reactions.get full=true` (the only complete source;
  the inline counts come truncated-roster-free from history). Pass a `ts` handle from a `read`/`search`
  row.

## Search (find a thing — NOT a window sweep)

- `npx -y slack-axi search "<query>"` — across the workspace.
- Modifiers: `--in <channel>`, `--from <@user>` (sender), `--with <@user>` (conversations including a
  person), `--after <date|span>`, `--before <date|span>`, `--limit <n>`, `--cite`.
- To read a channel over a window completely, use `read --from --to`, not `search`.

## Cite (permalinks for the messages you reference)

Read/search rows carry a compact `ts` handle, not a full permalink. To turn handles into permalinks:

- `npx -y slack-axi cite <channel> <ts> [<ts> ...]` — reconstructs permalinks (with `thread_ts` for
  replies) and emits `{channel, ts, permalink}` per message — ready to drop into a citation record.
- Or pass `--cite` to `read`/`search` to inline permalinks up front (for bulk ingestion).

## Setup (once per workspace)

- `npx -y slack-axi auth setup` — generates an app manifest (all scopes pre-filled, token rotation off)
  and walks you through creating + installing a Slack app, then `auth login --token xoxp-…`.
- `npx -y slack-axi setup hooks` — install a SessionStart hook so each agent session starts with the
  slack-axi home view as ambient context.
