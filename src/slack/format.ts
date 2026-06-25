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
 * Resolve Slack markup to readable text: `<@U|name>` mentions, `<#C|name>` channels, `<url|label>`
 * links, and basic entity decoding. Used by `read`, `thread`, and `search` output.
 */
export function formatText(text: string, users: Record<string, UserMeta>): string {
  return text
    .replace(/<@(U[A-Z0-9]+)(?:\|([^>]+))?>/g, (_m, id, name) => `@${name || userName(id, users)}`)
    .replace(/<#C[A-Z0-9]+\|([^>]+)>/g, (_m, name) => `#${name}`)
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, (_m, _url, label) => label)
    .replace(/<(https?:[^>]+)>/g, (_m, url) => url)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
