# Behavior: Links and link attachments (unfurls)

## Rule

A URL someone shared is never lost or cut. Wherever a message is rendered, every URL the message
carries — in its text or in its link-unfurl attachments — is shown **whole**: a URL is atomic under
truncation, a labeled link keeps its href, and unfurl metadata is surfaced as a `links` column rather
than dropped.

## Applies To

- `read` / `thread` — `links` column; link rendering in `text`.
- `catchup` — `[+N link(s)]` note (count only; the sweep stays lean).
- Text rendering everywhere `formatText` is used (`read`, `thread`, `catchup`, `search`).
- Truncation everywhere `truncate` is used (see [output-format.md](output-format.md)).

## Details

### Links in message text

Slack marks up a link in message text as `<url>` or `<url|label>`. Rendering:

- `<url>` → `url`, whole.
- `<url|label>` → `label (url)` — the label is kept for readability, the href is kept because the href
  is the thing the agent actually needs. Exception: when the label is merely a display form of the
  same URL (Slack labels a pasted link with its scheme-less or shortened form, e.g.
  `<https://docs.google.com/document/d/abc…|docs.google.com/document/d/abc…>`), render the `url`
  alone — the label adds nothing and would duplicate (or, worse, prefix-truncate) it.

### Link attachments (unfurls)

When a shared URL unfurls, Slack adds an `attachments[]` entry on the message carrying the canonical
link (`title_link`, else `from_url`, else `original_url`) plus a `title` and `service_name`. These
ride on the `conversations.history`/`replies` payload already fetched — **no extra call, no extra
scope**.

- `read`/`thread` surface them as a **`links` column**, uniform-when-present exactly like `files` and
  `reactions` (added only when some row in the view has a link attachment; empty for rows with none).
  Each entry renders `title <url>`; a title-less entry renders the bare `url`. Entries are `; `-joined
  in payload order, de-duplicated by URL. The URL is always complete.
- An attachment with no URL (a message share, a plain-text legacy attachment, an image-only unfurl)
  is not a link and is not listed.
- `catchup` appends `[+N link(s)]` to the row, mirroring `[+N file(s)]`; the agent runs `read`/`thread`
  on that channel for the URLs.
- The column is shown regardless of whether the same URL also appears in the message text: the unfurl
  contributes the page title (e.g. "Q3 budget — Google Docs"), which the bare URL in the text lacks.

Block Kit link elements are not read separately: Slack mirrors a message's blocks into its `text`
fallback, so block links are covered by text rendering.

### Truncation never cuts a URL

See [output-format.md → Truncation](output-format.md#truncation): when the truncation point would
land inside a URL, the preview extends to the end of that URL. A prefix of a URL is worse than no
URL — it cannot be followed and it looks like data.

## Principles

**Inherited:**

- [Never silently truncate](../principles.md#never-silently-truncate) — a URL is the one field whose
  prefix is worthless, so it is the one field truncation never touches.
- [One call returns the complete answer](../principles.md#one-call-returns-the-complete-answer) —
  unfurl URLs come from the same payload as the messages; recovering a shared link never needs a second
  command or the Slack UI.
- [Resolve identity for the agent](../principles.md#resolve-identity-for-the-agent) — a link's title
  is resolved and shown next to its href; the agent never has to open the URL to learn what it is.

**Local:**

- **The href outranks the label.** When a link must be shortened for display, cut the label, never
  the URL. Readability of prose is a nicety; a followable URL is the data.
