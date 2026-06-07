# Command: cite

Reconstruct permalinks (and full HQ citation sources) from message handles. The stateless companion to
`read`/`search`: those emit compact `ts` handles by default to save tokens; `cite` materializes the
expensive permalink for only the messages actually being cited. See
[permalinks.md](../behaviors/permalinks.md).

## Invocation

```
slack-axi cite <channel> <ts> [<ts> …]
```

`<channel>` accepts `#name`/name/id; each `<ts>` is a handle from a prior `read`/`search` row, in
dotless (`1717589640123456`) or dotted (`1717589640.123456`) form.

## Data Requirements

Stateless — needs only the channel (resolved to id) and the `ts` values. The permalink is constructed
locally (`https://<workspace>.slack.com/archives/<channel_id>/p<ts_without_dot>`, `?thread_ts=…` for a
reply); no read-session state is consulted. Slack `chat.getPermalink` may be used to confirm/obtain the
canonical URL but is not required for the construction.

## Output Rules

Per [output-format.md](../behaviors/output-format.md). Returns one row per handle with the full HQ
`slack_message` source shape, so the result is a direct field-copy into an HQ citation:

```
workspace: Jarvus (T01ABC)
channel: #eng (C0B)
citations[2]{ts,permalink}:
  1717589640123456,https://jarvus.slack.com/archives/C0B/p1717589640123456
  1717589700234567,https://jarvus.slack.com/archives/C0B/p1717589700234567?thread_ts=1717589640.123456
```

- With `--fields text,author` it also echoes the cited message's text/author for verification.
- A `ts` that doesn't resolve to a message in the channel → a per-row error note (not a whole-command
  failure); other handles still resolve.
- Self-contained detail view — no `help[]`.

## Actions

None (read-only reconstruction).

## Principles

**Inherited:**

- [One call returns the complete answer](../principles.md#one-call-returns-the-complete-answer) — `cite`
  is the deliberate deferral of the permalink bytes: the handle travels on every row for free, the URL
  is built only when cited. slack-axi still owns the string surgery (pain #9 stays fixed).
- [Token-frugal, content-first output](../principles.md#token-frugal-content-first-output) — the reason
  `cite` exists as a separate verb rather than permalinks-on-every-row.
