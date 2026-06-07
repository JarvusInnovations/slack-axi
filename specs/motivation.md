# Motivation: the pain this replaces

slack-axi exists to replace the claude.ai Slack MCP, which fails in specific, recurring ways. This is
the evidence base the rest of the specs answer to — every fix below is operationalized in a principle,
behavior, or command spec (linked inline). The throughline: **roughly half of these are date/window
correctness failures** (#3, #4, #7) that silently corrupted the HQ journal with wrong-period data and
were caught only by luck or manual intervention. Nail "human dates in → human dates + permalinks +
completeness markers out" and most of the documented pain disappears.

## Evidence sources

- **Live complaints** (session `bc4c0dfd`, 2026-06-07): "constantly getting logged out"; "fails to
  find relevant channels … like pulling teeth to get it to find private channels and group DMs";
  "always fails to read messages on the first pass … messes up the query"; "channel messages and
  thread replies have to get read separately."
- **`hq-usage` skill** (`~/Hari/.claude/skills/hq-usage/SKILL.md`) — the codified band-aid that
  encodes manual workarounds for every issue below. slack-axi exists so this skill can be gutted.
- **Transcript evidence** (Hari + biz-dev repos): sessions `7f5bd203` (2026-03-30, oldest-first
  pagination caught burying the RTD proposal-loss narrative), `f2f1042a` (2026-03-21, private-channel
  discovery failure resolved only by pasting raw IDs), `a67162c2` (2026-06-07, Slack MCP blocking the
  HQ catch-up for ~6 weeks), `d459d583`/`ad10aca6` (biz-dev, parallel-subagent Slack sweeps).

## Pain catalog

| # | Symptom (with evidence) | Root cause | Fix → spec |
| --- | --- | --- | --- |
| 1 | Constantly logged out (`bc4c0dfd`) | Stateful/rotating session (browser `xoxc`/`xoxd` cookie or interactive OAuth) | Long-lived `xoxp-` user token stored once → [auth-and-workspaces.md](behaviors/auth-and-workspaces.md), [principles#stateless](principles.md#stateless-unattended-safe) |
| 2 | Interactive OAuth breaks headless/scheduled runs; stalled the HQ catch-up ~6 weeks (`a67162c2`) | MCP `authenticate`/`complete_authentication` is interactive; absent in cron/headless | `SLACK_AXI_TOKEN` env, no interactive step → [auth-and-workspaces.md](behaviors/auth-and-workspaces.md) |
| 3 | **Year-wrong timestamps** — 2025 ts meaning 2026, returned plausible year-old data "multiple times" (`hq-usage` L167/L414) | Raw epoch `oldest`/`latest`; hand-computed seconds silently match the wrong year | Human dates in; **resolved range echoed back with explicit year+tz** → [time-and-completeness.md](behaviors/time-and-completeness.md), [principles#time](principles.md#the-agent-never-computes-time) |
| 4 | Oldest-first pagination gaps — first read silently incomplete; nearly buried the RTD loss narrative (`7f5bd203`, `f2f1042a`) | Opaque cursors, no completeness signal | Paginate to completion, stable chronological order, explicit `complete: true/false` + count → [time-and-completeness.md](behaviors/time-and-completeness.md), [principles#truncate](principles.md#never-silently-truncate) |
| 5 | `search` vs `read` confusion — skill must mandate "use read NOT search" (`hq-usage` L170) | One overloaded path for "find a thing" and "sweep a window" | `read --from --to` is the primary window verb; `search` scoped to finding → [search.md](commands/search.md), [principles#read-vs-search](principles.md#read-is-for-windows-search-is-for-finding) |
| 6 | Private channels & group DMs undiscoverable; only worked after pasting raw IDs (`f2f1042a`) | Listing defaults to public-only; agent must guess `types` | `channels` defaults to `users.conversations` across all types → [channels.md](commands/channels.md), [principles#identity](principles.md#resolve-identity-for-the-agent) |
| 7 | Old activity masquerades as current — Dec-2024/Oct-2025 content surfaced for a Mar-2026 window (`f2f1042a`, `hq-usage` L173) | No date framing in output (compounds #3/#4) | Human Eastern datetime per message, grouped by date → [time-and-completeness.md](behaviors/time-and-completeness.md) |
| 8 | Threads are a separate call; decisions in replies missed (`hq-usage` L171, `7f5bd203`) | `conversations.history` and `.replies` are distinct calls | `read` inlines replies under parents by default → [threads.md](behaviors/threads.md), [principles#one-call](principles.md#one-call-returns-the-complete-answer) |
| 9 | **Permalinks hand-assembled** (`…/p{ts_without_dot}`), missed on real citations and retro-fixed (`hq-usage` L219/L295, `7f5bd203`) | MCP returns no permalink | A compact `ts` handle on every row + `cite`/`--cite` builds the permalink (slack-axi does the string surgery, on demand, token-frugally) → [permalinks.md](behaviors/permalinks.md), [cite.md](commands/cite.md) |
| 10 | Name ↔ id friction; HQ stores `{name,id}` pairs | Reads need ids; humans/HQ think in names | Accept `#name`/name/id everywhere; output pairs name+id → [resolution-and-caching.md](behaviors/resolution-and-caching.md) |
| 11 | Subagent dispatch fragility — "Bash may not be available", re-specify tool each time (`hq-usage` L414) | MCP tool presence varies per subagent | A plain CLI is available wherever Bash is → [principles#stateless](principles.md#stateless-unattended-safe) |
| 12 | Token-heavy JSON; agents must wade through bot noise (`hq-usage` L175) | MCP verbosity | TOON output, raw `ts` retained for citations, opt-in bot filtering → [output-format.md](behaviors/output-format.md) |

## Downstream consumer: HQ

The primary consumer is HQ journal ingestion (the `hq-usage` skill's weekly sweeps over `#bid-*` /
`#wmata-*` channels). slack-axi output is shaped to drop into HQ's citation formats with no string
surgery — see [permalinks.md → HQ citation alignment](behaviors/permalinks.md). Channel naming
conventions observed: `#bid-*` (proposals, richest BD timelines), `#wmata-*` (per-project),
per-engagement channels; both public and private, plus group DMs and DMs. Only the **Jarvus**
workspace is confirmed in current use, though the design supports multi-workspace from day one.
