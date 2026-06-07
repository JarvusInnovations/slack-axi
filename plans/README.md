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
| `02-discovery` | `channels`/`dms`/`members`, resolution cache, home view | 01 |
| `03-read` | `read` + `thread`: human time, completeness, inlined threads, permalinks | 02 |
| `04-search` | `search` (+ `search channels`) | 03 |
| `05-writes` | `react`, `draft`, `draft send` | 02 |
| `06-ambient-setup` | `auth setup` progressive flow, `setup hooks`, installable skill | 02 |
