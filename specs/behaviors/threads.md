# Behavior: Thread inlining

## Rule

`read` returns a channel's messages **and their thread replies in one call**, replies nested under
their parent. The agent never has to issue a separate per-parent replies call to see where a decision
was made.

## Applies To

`read` (default behavior). `thread <channel> <ts>` is the explicit single-thread deep-dive.

## Details

### Inlining modes (`--threads`)

- `full` (default) — for every parent with `reply_count > 0`, fetch its replies
  (`conversations.replies`) and render them nested beneath the parent, marked `↳`, in chronological
  order. Replies that fall outside the requested time window are still included when their parent is in
  window (a thread is a unit).
- `summary` — show the parent plus `reply_count` and the latest reply's author/time, without expanding
  every reply. Cheaper for wide sweeps.
- `none` — top-level messages only; `reply_count` still shown so the agent knows a thread exists.

### Ordering and completeness

- The merged output preserves the channel's chronological order at the top level (oldest→newest within
  each date group); replies are chronological within their parent. See
  [time-and-completeness.md](time-and-completeness.md).
- Reply fetching is subject to the same pagination-to-completion rule — all replies of an in-window
  parent are retrieved, not just the first page.

### `thread` command

- `slack-axi thread <channel> <ts>` returns one thread fully: the parent and all replies, names
  resolved, each with a permalink. No time window needed.

## Principles

**Inherited:**

- [One call returns the complete answer](../principles.md#one-call-returns-the-complete-answer) —
  inlining replies is a core instance: the reply chain is exactly the follow-up call we refuse to make
  the agent issue.
