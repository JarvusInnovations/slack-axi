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

**Upgrading:** a release can add a required scope (for example `files:write`, for draft attachments).
`doctor` and `auth setup` name any missing scope. To add it, open your app at
<https://api.slack.com/apps>, add the scope under **OAuth & Permissions → User Token Scopes**, and click
**Reinstall to Workspace**. Slack keeps the same token, so there's no need to run `auth login` again.

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
slack-axi file <file-id…> [--full]           # print a snippet's / text file's text inline
slack-axi read/thread … --full   # untruncated text (help[] names --full whenever text was cut)
slack-axi search ["<query>"] [--in #c] [--from @u] [--with @u] [--after <d>]  # find a thing (query optional if a filter narrows)
slack-axi catchup [--since 1d] [--match q] [--in ...] [--full]   # scoped multi-channel sweep
slack-axi catchup --every 1w …  # plan a month+ catch-up as weekly batches
slack-axi cite <channel> <ts…>  # permalinks + the { channel, ts, permalink } citation shape
slack-axi react <channel> <ts> :emoji:                  # reactions:write
slack-axi draft <channel> "<markdown>" [--reply <ts>] [--raw] [--preview]   # prepare a message (does NOT send)
slack-axi draft <channel> "…" --file <path> --snippet <path>   # attach files / snippets (uploaded at send)
slack-axi draft send <id>       # the explicit, separate step that posts
slack-axi edit <channel> <ts> "<markdown>"   # prepare an edit of YOUR OWN message (or: edit <sent-draft-id> "…")
slack-axi delete <channel> <ts>           # prepare deletion of YOUR OWN message (or: delete <sent-draft-id>)
                                # … both applied by the same `draft send <id>` step
slack-axi auth mode [human|bot|auto]   # how outgoing Markdown is rendered (see below)
slack-axi setup hooks           # install the SessionStart ambient-context hook
```

Every command supports `--help`. Channel args accept `#name` / name / id. Output is TOON with
contextual `help[]` next steps; errors are structured with actionable suggestions.

### Capabilities

Read + **safe-draft**: full read/search/sweep, plus reactions and message *drafts you approve*. Drafts
can attach local files (`--file`) and snippets (`--snippet`), pinned when the draft is made and uploaded
only at `draft send`. Attachments are readable too: `download` saves a file's bytes, and `file` prints a
snippet's or text file's content inline. Nothing
posts, changes, or disappears without an explicit `draft send` — `edit`/`delete` prepare drafts too, and
only for messages the token itself posted (checked against the authed user id, or the bot id for a bot
token); there is no override.

### Writing messages: write Markdown

`draft` and `edit` take **Markdown** and render it to Slack's dialect for the workspace **mode**
(`slack-axi auth mode` shows or sets it; derived from the token at login):

| Mode | Token | Renders to | Why |
| --- | --- | --- | --- |
| `human` (default) | user token `xoxp-` | mrkdwn text | stays editable with formatting intact in the Slack client |
| `bot` | bot token `xoxb-` | Block Kit (≤50 blocks per message, one table per message) + text fallback | real headers, lists, tables; nothing is hand-edited |

Human-mode before/after:

| Markdown | mrkdwn |
| --- | --- |
| `**bold**` | `*bold*` |
| `*em*` / `_em_` | `_em_` (a single `*` is italic — write `**` for bold) |
| `~~gone~~` | `~gone~` |
| `# Heading` | `*Heading*` |
| `- item` (nesting kept) | `• item` |
| `[text](url)` | `<url\|text>` |
| `` `code` ``, fences, `> quote` | unchanged |

Slack-native tokens you write by hand (`<@U…>`, `<#C…\|name>`, `<!here>`, `<url\|label>`, `•` bullets)
pass through untouched in both modes. `--raw` skips rendering entirely; `--preview` prints the
rendering without saving a draft. See `specs/behaviors/mrkdwn.md`.

## Development

```sh
bun install
bun run build        # tsc → dist/
bun test             # vitest (time/window math is unit-tested)
```

The project is spec-driven — specs in [`specs/`](specs/) are the source of truth; work is tracked as
plans in [`plans/`](plans/). Requires Node ≥ 22 (built/run with bun; published to run under node).

## License

MIT © Jarvus Innovations
