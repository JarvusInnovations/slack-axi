# slack-axi specs

Specs are the source of truth for slack-axi. Implementation follows spec. All work begins with a
spec update — see the SpecOps workflow (the `specops` skill) for the full loop.

`motivation.md` holds the *why* — the pain-point catalog and the session evidence the specs answer to.
The rest of these specs are the declarative *what* an implementer brings the code into conformance
with. (The original design narrative, `docs/design.md`, was folded entirely into these specs and
removed; it survives in git history at commit `880f451`.)

## Layout

```
specs/
  README.md          # this file
  motivation.md      # the pain catalog + session evidence the specs answer to (the "why")
  principles.md      # decisive cross-cutting rules — the slack-axi philosophy written down
  architecture.md    # stack, project structure, storage layout, foundational decisions
  commands/          # one file per CLI command (the "screen" analogue for a CLI)
    home.md          # no-args content-first view
    auth.md          # setup / login / workspaces / use / revoke
    doctor.md        # health + scope coverage
    channels.md      # channels / dms / members / search channels
    read.md          # read <channel> + thread <channel> <ts>
    search.md        # search.messages
    cite.md          # reconstruct permalinks / HQ sources from ts handles
    write.md         # react / draft / draft send
    setup-hooks.md   # ambient-context hook + skill install
  behaviors/         # cross-cutting rules that span commands
    output-format.md       # TOON, schemas, truncation, aggregates, empty states, help[]
    time-and-completeness.md   # human time in, resolved-range echo, pagination-to-completion
    resolution-and-caching.md  # #name|id channels, user-id→name, local caches
    threads.md             # inlining replies under parents
    permalinks.md          # ready-to-use permalink on every message
    errors.md              # Slack error → AxiError translation, exit codes
    auth-and-workspaces.md # token resolution order, multi-workspace, write-protection
```

## Conventions

- A command spec declares: invocation/flags, data sources (Slack Web API methods), output rules,
  actions/mutations, and contextual `help[]` suggestions.
- Cross-cutting rules (output format, time handling, error translation) live once in `behaviors/`
  and are referenced from command specs rather than restated.
- Every spec may carry a `## Principles` section: **Inherited** (linked `principles.md` entries that
  bite here) and **Local** (decisive rules owned by this spec; promote when they spread).
- Output examples in specs are illustrative of *shape*, not literal fixtures.

## Plans

`plans/` holds the work DAG (motion). Specs describe state; plans describe how we get there. See
`plans/README.md`.
