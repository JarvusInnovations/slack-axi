import type { UserMeta } from "./cache.js";

/** A human label for a user id from a pre-loaded users map (display → real → handle → id). */
export function userName(id: string, users: Record<string, UserMeta>): string {
  const u = users[id];
  return u ? u.display_name || u.real_name || u.name || id : id;
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
