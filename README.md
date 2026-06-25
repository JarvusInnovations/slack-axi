# slack-axi

An [AXI](https://github.com/JarvusInnovations) (Agent eXperience Interface) CLI for Slack — built for
agents to drive over the shell. Read, search, sweep, and safely draft Slack with token-efficient
[TOON](https://toonformat.dev/) output. It replaces the flaky Slack MCP with a stored long-lived user
token (no logouts, works headless), human date ranges (no epoch math), threads inlined, and
ready-to-cite permalinks.

## Why

The Slack MCP it replaces failed in recurring ways; slack-axi fixes each at the root:

| Pain | Fix |
| --- | --- |
| Constant logouts / breaks headless | long-lived `xoxp` user token, resolvable from env — no session, no daemon |
| Can't find private channels / group DMs | `channels` lists all conversation types you belong to by default |
| Wrong-year timestamps | human dates in; the resolved range is **echoed back with explicit year + tz** |
| Oldest-first / dropped messages | reads paginate to completion with a `complete:` marker; windows tile losslessly |
| Threads are a second call | thread replies are inlined under their parent |
| Hand-built permalinks | a compact `ts` handle per row + a stateless `cite` command |
| name ↔ id friction | `#name`, bare name, or id accepted everywhere |

See [`specs/`](specs/) for the full specification and [`specs/motivation.md`](specs/motivation.md) for
the evidence behind each fix.

## Install

```sh
npm install -g slack-axi        # or: bun add -g slack-axi
slack-axi auth setup            # guided: create a Slack app from a manifest, then paste the token
```

`auth setup` generates an app manifest with all required user-token scopes pre-filled (and token
rotation disabled), walks you through creating + installing the app, then `auth login --token xoxp-…`.
Run `slack-axi doctor` to verify auth and scope coverage.

## Commands

```
slack-axi                       # home: active workspace + channel count
slack-axi channels [--match q] [--type ...] [--all]   # discover (all conversation types)
slack-axi dms                   # DMs + group DMs
slack-axi members <channel>     # channel members (external/guest names resolved on demand)
slack-axi user <id|@handle>     # look up a user: name, external/guest/bot
slack-axi read <channel> [--since 7d | --from <d> --to <d>] [--threads ...]  # the primary verb
slack-axi thread <channel> <ts> # one thread, fully
slack-axi reactions <channel> <ts>  # full reactor roster (read/thread show inline counts)
slack-axi download <file-id…> [--out <dir>]  # fetch message attachments to disk (read/thread list ids)
slack-axi search "<query>" [--in #c] [--from @u] [--with @u] [--after <d>]   # find a thing
slack-axi catchup [--since 1d] [--match q] [--in ...]   # scoped multi-channel sweep
slack-axi catchup --every 1w …  # plan a month+ catch-up as weekly batches
slack-axi cite <channel> <ts…>  # permalinks + the { channel, ts, permalink } citation shape
slack-axi react <channel> <ts> :emoji:                  # reactions:write
slack-axi draft <channel> "<text>" [--reply <ts>]       # prepare a message (does NOT send)
slack-axi draft send <id>       # the explicit, separate step that posts
slack-axi setup hooks           # install the SessionStart ambient-context hook
```

Every command supports `--help`. Channel args accept `#name` / name / id. Output is TOON with
contextual `help[]` next steps; errors are structured with actionable suggestions.

### Capabilities

Read + **safe-draft**: full read/search/sweep, plus reactions and message *drafts you approve*. Nothing
posts without an explicit `draft send`.

## Development

```sh
bun install
bun run build        # tsc → dist/
bun test             # vitest (time/window math is unit-tested)
```

The project is spec-driven — specs in [`specs/`](specs/) are the source of truth; work is tracked as
plans in [`plans/`](plans/). Requires Node ≥ 20 (built/run with bun; published to run under node).

## License

MIT © Jarvus Innovations
