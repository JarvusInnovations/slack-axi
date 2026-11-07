import type { UserMeta } from "./cache.js";

/**
 * How a user id that can't be resolved to a name is rendered. Marked explicitly so a consumer never
 * mistakes a raw id for a resolved handle (and an agent never feels licensed to guess a name for it).
 * Display-only: this string must never be parsed back into an id — see `resolveUserId`.
 */
export function unresolvedLabel(id: string): string {
  return `${id} (unresolved)`;
}

/** A human label for a user id from a pre-loaded users map (display → real → handle → unresolved). */
export function userName(id: string, users: Record<string, UserMeta>): string {
  const u = users[id];
  return (u && (u.display_name || u.real_name || u.name)) || unresolvedLabel(id);
}

/** Slack user-mention ids referenced in message markup (`<@U…>`), for cache hydration. */
export function mentionedUserIds(text: string): string[] {
  return [...text.matchAll(/<@(U[A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]);
}

/**
 * Render a Slack `<url|label>` link. The href is the thing the agent needs, so it is always kept:
 * `label (url)`. When the label is only a display form of the same URL (Slack labels a pasted link
 * with its scheme-less, often shortened, form), the URL alone is rendered — the label would duplicate
 * or, worse, prefix-truncate it. See specs/behaviors/links.md.
 */
export function formatLink(url: string, label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return url;
  const bareUrl = url.replace(/^https?:\/\//, "");
  const bareLabel = trimmed.replace(/^https?:\/\//, "");
  // Slack shortens a long pasted URL's label with an ellipsis (`…` or `...`), at the end or in the
  // middle: `docs.google.com/document/d/1Cvq…/edit?usp=sharing`. Match prefix + suffix around it.
  const [head, tail = ""] = bareLabel.split(/…|\.\.\./, 2);
  const isDisplayForm =
    head.length > 0 &&
    bareUrl.startsWith(head) &&
    bareUrl.endsWith(tail) &&
    head.length + tail.length <= bareUrl.length;
  if (isDisplayForm) return url;
  return `${trimmed} (${url})`;
}

/**
 * Resolve Slack markup to readable text: `<@U|name>` mentions, `<#C|name>` channels, `<url|label>`
 * links (href kept — see `formatLink`), and basic entity decoding. Used by `read`, `thread`,
 * `catchup`, and `search` output.
 */
export function formatText(text: string, users: Record<string, UserMeta>): string {
  return text
    .replace(/<@(U[A-Z0-9]+)(?:\|([^>]+))?>/g, (_m, id, name) => `@${name || userName(id, users)}`)
    .replace(/<#C[A-Z0-9]+\|([^>]+)>/g, (_m, name) => `#${name}`)
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, (_m, url, label) => formatLink(url, label))
    .replace(/<(https?:[^>]+)>/g, (_m, url) => url)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
