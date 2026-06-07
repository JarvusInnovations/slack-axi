# Command: setup hooks (ambient context + skill)

Registers slack-axi into the agent session lifecycle so every conversation starts with the workspace
state already visible, and provides an installable skill as a secondary discovery path.

## Invocation

`slack-axi setup hooks` — idempotent; repeated installs with the same path are silent no-ops.

## Behavior

- Installs a **SessionStart hook** via `axi-sdk-js`'s `installSessionStartHooks`, targeting Claude Code
  (`~/.claude/settings.json`), Codex (`~/.codex/hooks.json` + `config.toml`), and OpenCode by default.
- At session start the hook runs slack-axi's no-args [home view](home.md) and injects it as ambient
  context — token-budget-minimal (workspace, unread/mention count, top channels).
- **Path repair:** if a hook already exists with a stale executable path (after reinstall/relocation),
  update it. Use a PATH-verified `slack-axi` when it resolves to this executable, else the absolute
  path.
- Explicit opt-in only — installed from this command, never from ordinary command runs.

## Installable skill (secondary)

- A `SKILL.md` is generated from the same content as the no-args home view (single source of truth),
  with live state stripped and command examples rewritten to `npx -y slack-axi …`.
- A `--check` build step fails CI if the committed skill drifts from the generated content.
- Frontmatter `description` is trigger-shaped (terse, outcome-focused) so agents load it on Slack
  intent. README documents hook (primary) and skill (secondary) as two paths to the same end; a user
  installs whichever fits.

## Output Rules

Returns an install-status object (which integrations were installed/updated/skipped). Self-contained;
no `help[]`.

## Principles

**Inherited:**

- [Token-frugal, content-first output](../principles.md#token-frugal-content-first-output) — the
  injected ambient context must stay minimal because it loads on every session.
