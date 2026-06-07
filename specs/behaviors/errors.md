# Behavior: Errors and exit codes

## Rule

Slack API errors are translated to structured `AxiError`s on stdout, in the same TOON format as normal
output, each carrying an actionable suggestion that references a slack-axi command. Raw Slack/SDK
payloads never leak. Mutations are idempotent. Exit codes: 0 success/no-op, 1 error, 2 usage.

## Applies To

Every command. Implemented in `slack/errors.ts` (`translateSlackError`) and the `axi-sdk-js` error
framework (`AxiError`, `exitCodeForError`).

## Details

### Translation table (Slack `error` code → AxiError)

| Slack error | AxiError code | Suggestion |
| --- | --- | --- |
| `invalid_auth` / `token_revoked` / `account_inactive` | `AUTH_INVALID` | `Run 'slack-axi auth login --team <id>' to re-store a valid token` |
| `missing_scope` (needed vs. granted) | `SCOPE_MISSING` | `Token lacks scope '<x>'. Re-run 'slack-axi auth setup' and add it, then re-install the app` |
| `channel_not_found` | `CHANNEL_NOT_FOUND` | `Run 'slack-axi channels' to list yours, or 'slack-axi search channels <q>'` + fuzzy matches |
| `not_in_channel` | `NOT_IN_CHANNEL` | `You're not a member of <channel>; join it in Slack or use 'slack-axi channels --all' to confirm the id` |
| `thread_not_found` / `message_not_found` | `MESSAGE_NOT_FOUND` | `Check the ts; run 'slack-axi read <channel>' to find the message` |
| `ratelimited` | `RATE_LIMITED` | handled by SDK retry; if exhausted, `Retry after <n>s` |
| `not_authed` / no token resolved | `NO_TOKEN` | `Set SLACK_AXI_TOKEN or run 'slack-axi auth login'` |

Unmapped Slack errors become a generic `SLACK_ERROR` with the cleaned message and a `doctor`
suggestion — never a raw stack trace.

### Rate limiting

`@slack/web-api` handles tiered rate-limit retry with backoff automatically. slack-axi surfaces a
`RATE_LIMITED` error only when retries are exhausted, with the retry-after hint.

### Idempotent mutations

- `react` on an emoji already present → `reaction: :x: already on message (no-op)`, exit 0.
- `draft send` on an already-sent draft → acknowledges the prior send, exit 0.
- Reserve non-zero exit only for intents that genuinely cannot be satisfied. See
  [principles.md → Writes are safe by default](../principles.md#writes-are-safe-by-default).

### Validation

Required flags/args are validated before any API call; a missing one fails immediately with exit 2 and
a usage-shaped suggestion. No interactive prompts — every operation is completable with flags alone.

## Principles

**Inherited:**

- [Stateless, unattended-safe](../principles.md#stateless-unattended-safe) — `NO_TOKEN`/`AUTH_INVALID`
  must point at the non-interactive fix (env or `auth login`), never an interactive prompt.
