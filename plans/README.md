# plans

Plans are the work DAG (motion). Specs in `specs/` describe state (what should be true); plans
describe how we get there next. Each plan declares scope, the specs it implements, dependencies, and
concrete validation criteria. Once merged, a plan freezes as historical record.

See the `specops` skill's `references/plans-protocol.md` for the full protocol (frontmatter schema,
body template, status lifecycle, closeout ritual, Follow-ups taxonomy).

The authoritative DAG lives in the plan frontmatter — don't hand-maintain a diagram or status table
here. Query it on demand:

- `<specops-skill>/scripts/plans-dag plans/` — Mermaid graph styled by status
- `<specops-skill>/scripts/plans-next plans/` — plans ordered by readiness

## Initial plan set

| slug | scope | depends |
| --- | --- | --- |
| `01-scaffold-auth` | repo scaffold, CLI harness, `auth login`, `doctor` | — |
| `01b-auth-setup` | guided manifest-based `auth setup` (pulled forward to dogfood) | 01 |
| `02-discovery` | `channels`/`dms`/`members`, resolution cache, home view | 01 |
| `03-read` | `read` + `thread` + `cite`: human time, completeness, inlined threads | 02 |
| `04-search` | `search` (+ `search channels`) | 03 |
| `05-writes` | `react`, `draft`, `draft send` | 02 |
| `06-ambient-setup` | `setup hooks` + installable skill (ambient context) | 02 |
| `07-catchup` | scoped multi-channel sweep ("everything since yesterday") | 03 |
| `07b-catchup-batching` | `catchup --every` batch planning + half-open window correctness | 07 |
