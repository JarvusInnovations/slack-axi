---
status: in-progress
depends: [17-conversation-audience]
specs:
  - specs/behaviors/errors.md
  - specs/behaviors/output-format.md
  - specs/behaviors/auth-and-workspaces.md
  - specs/commands/auth.md
  - specs/commands/channels.md
  - specs/commands/search.md
  - specs/commands/write.md
  - specs/commands/audience.md
  - specs/principles.md
issues: [43]
---

# 18 — Align with the jarvus-axi house style

## Scope

slack-axi predates several conventions in the `jarvus-axi` skill (`.agents/skills/jarvus-axi/`).
This plan does the four "Should fix" items of issue #43.

**In:**

- Declared per-command flag specs. An unknown `--flag` fails as `UNKNOWN_FLAG` and lists that
  command's valid flags; extra positionals fail as `USAGE`. Dash-led free text stays text.
- A `formatError` so `USAGE` / `UNKNOWN_FLAG` / `VALIDATION_ERROR` exit 2 and an unexpected error
  becomes `INTERNAL_ERROR` with a `doctor` hint.
- Unknown `--fields` names are an error listing the valid names.
- `auth login --token-stdin`; `SLACK_AXI_TOKEN` as the fallback; hints show the stdin pipe.
- Totals move from the TOON array header (`channels[5 of 47]`) to a `count: 5 of 47` header field.

**Out** (the issue's "Smaller" list; each is its own plan): `doctor` rows as `ok|fail|skipped`;
help and skill generated from one `reference.ts`; the `--version` fast path and the `axi-sdk-js`
bump; `setup hooks status|uninstall|--scope`.

## Implements

- `specs/behaviors/errors.md` — Exit codes, Declared flags, the `UNKNOWN_FLAG` wording.
- `specs/behaviors/output-format.md` — `--fields` validation; the `count:` header field.
- `specs/commands/auth.md`, `specs/behaviors/auth-and-workspaces.md` — `--token-stdin`.
- `specs/commands/{channels,search,write,audience}.md`, `specs/principles.md` — the examples and
  codes that follow from the above.

## Approach

1. `src/flags.ts`: `FlagSpec` + `parseFlags(command, argv, spec)` shaped like the canonical parser
   (nexudus-axi `src/flags.ts`), adapted rather than copied because this tool takes free text as
   positionals: only `--<letter>` starts a flag, so `- item`, `---`, `-word` and `-5` stay text. One
   `FLAG_SPECS` table holds every command's declaration. `--team` is allowed everywhere except the
   commands that never resolve a workspace.
2. Every command parses through `parseFlags`; the `takeFlag`/`takeBool`/`textArgs` helpers go away.
3. `src/cli.ts`: export `formatError` (ported from nexudus-axi `src/cli.ts`) and pass it to
   `runAxiCli`.
4. `channels --fields`: validate against the three known names.
5. `auth login`: `--token-stdin`, then `--token`, then `SLACK_AXI_TOKEN`. One hint string for the
   stdin pipe, used by every "log in" hint.
6. `renderList`: when a total is given, print `count: N of M` above an array whose header is the row
   count. `draft list` prints `count: N pending of M`.
7. README, the skill and command help follow.

## Validation

- [ ] `bun run lint`, `format:check`, `typecheck`, `build`, `test` all clean.
- [ ] A sweep test runs every entry of `FLAG_SPECS` with `--bogus` and gets `UNKNOWN_FLAG` naming
      that command's flags.
- [ ] Every declared flag appears in that command's `--help`.
- [ ] Dash-led text (`- item`, `---`, `-word`, `-5`) still parses as text for `draft`, `edit`,
      `search`.
- [ ] The built CLI exits 2 on an unknown flag and on a usage error, with HOME in a temp directory.
- [ ] `formatError` unit tests: the three usage codes exit 2, other `AxiError`s exit 1, a plain
      `Error` becomes `INTERNAL_ERROR`.
- [ ] `channels --fields nope` fails before any Slack call and lists the valid names.
- [ ] `auth login --token-stdin` stores the piped token; `--token` still works; both together fail;
      no source fails with the stdin hint.
- [ ] `renderList` never writes a total into the array header.

## Risks / unknowns

- **Breaking output shape.** Anything that parsed `label[N of M]` must read `count:` instead.
- **Stricter parsing.** Invocations that passed a stray flag or an extra argument, and were silently
  tolerated, now fail with exit 2.
