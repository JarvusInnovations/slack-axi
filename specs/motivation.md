# Motivation: the pain this replaces

slack-axi exists to replace the claude.ai Slack MCP, which fails in specific, recurring ways. This is
the evidence base the rest of the specs answer to — every fix below is operationalized in a principle,
behavior, or command spec (linked inline). The throughline: **roughly half of these are date/window
correctness failures** (#3, #4, #7) that silently corrupt a downstream knowledge base with wrong-period
data and were caught only by luck or manual intervention. Nail "human dates in → human dates +
permalinks + completeness markers out" and most of the documented pain disappears.

## Evidence sources

The pain catalog is drawn from real, sustained use of the Slack MCP for knowledge-base ingestion —
direct user complaints, the manual workarounds a downstream ingestion skill had to codify to cope, and
agent-session transcripts where the failures were caught in the act. Specifics (channels, clients,
internal repos, session ids) are intentionally omitted here; the symptoms and root causes below are
what the design answers to.

## Pain catalog

| #   | Symptom                                                                              | Root cause                                                                       | Fix → spec |
| --- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | --- |
| 1   | Constantly logged out                                                                | Stateful/rotating session (browser `xoxc`/`xoxd` cookie or interactive OAuth)    | Long-lived `xoxp-` user token stored once → [auth-and-workspaces.md](behaviors/auth-and-workspaces.md), [principles#stateless](principles.md#stateless-unattended-safe) |
| 2   | Interactive OAuth breaks headless/scheduled runs; blocked an unattended catch-up     | MCP `authenticate`/`complete_authentication` is interactive; absent in cron/headless | `SLACK_AXI_TOKEN` env, no interactive step → [auth-and-workspaces.md](behaviors/auth-and-workspaces.md) |
| 3   | **Year-wrong timestamps** — a prior year's `ts` returned plausible year-old data     | Raw epoch `oldest`/`latest`; hand-computed seconds silently match the wrong year | Human dates in; **resolved range echoed back with explicit year+tz** → [time-and-completeness.md](behaviors/time-and-completeness.md), [principles#time](principles.md#the-agent-never-computes-time) |
| 4   | Oldest-first pagination gaps — first read silently incomplete; nearly lost a thread  | Opaque cursors, no completeness signal                                           | Paginate to completion, stable chronological order, explicit `complete: true/false` + count → [time-and-completeness.md](behaviors/time-and-completeness.md), [principles#truncate](principles.md#never-silently-truncate) |
| 5   | `search` vs `read` confusion — guidance had to mandate "use read NOT search"         | One overloaded path for "find a thing" and "sweep a window"                      | `read --from --to` is the primary window verb; `search` scoped to finding → [search.md](commands/search.md), [principles#read-vs-search](principles.md#read-is-for-windows-search-is-for-finding) |
| 6   | Private channels & group DMs undiscoverable; only worked after pasting raw IDs       | Listing defaults to public-only; agent must guess `types`                        | `channels` defaults to `users.conversations` across all types → [channels.md](commands/channels.md), [principles#identity](principles.md#resolve-identity-for-the-agent) |
| 7   | Old activity masquerades as current — stale content surfaced for a recent window     | No date framing in output (compounds #3/#4)                                      | Human Eastern datetime per message, grouped by date → [time-and-completeness.md](behaviors/time-and-completeness.md) |
| 8   | Threads are a separate call; decisions in replies missed                             | `conversations.history` and `.replies` are distinct calls                        | `read` inlines replies under parents by default → [threads.md](behaviors/threads.md), [principles#one-call](principles.md#one-call-returns-the-complete-answer) |
| 9   | **Permalinks hand-assembled** (`…/p{ts_without_dot}`), missed on real citations      | MCP returns no permalink                                                         | A compact `ts` handle on every row + `cite`/`--cite` builds the permalink (slack-axi does the string surgery, on demand, token-frugally) → [permalinks.md](behaviors/permalinks.md), [cite.md](commands/cite.md) |
| 10  | Name ↔ id friction; the knowledge base stores `{name,id}` pairs                      | Reads need ids; humans think in names                                            | Accept `#name`/name/id everywhere; output pairs name+id → [resolution-and-caching.md](behaviors/resolution-and-caching.md) |
| 11  | Subagent dispatch fragility — "Bash may not be available", re-specify tool each time | MCP tool presence varies per subagent                                            | A plain CLI is available wherever Bash is → [principles#stateless](principles.md#stateless-unattended-safe) |
| 12  | Token-heavy JSON; agents must wade through bot noise                                 | MCP verbosity                                                                     | TOON output, raw `ts` retained for citations, opt-in bot filtering → [output-format.md](behaviors/output-format.md) |

## Downstream consumer

The motivating consumer is an automated **knowledge-base ingestion** workflow: a skill that sweeps
relevant Slack channels for a period and journals decisions/status into a Git-backed knowledge base,
citing the source messages. slack-axi's output is shaped to drop into that citation format with no
string surgery — see
[permalinks.md → citation alignment](behaviors/permalinks.md). That workflow reads both public and
private channels plus group DMs and DMs, and stores channel references as `{name, id}` pairs (hence the
name↔id and discovery requirements above). The design supports multiple workspaces from day one.
