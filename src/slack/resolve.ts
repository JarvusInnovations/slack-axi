import { AxiError } from "axi-sdk-js";
import type { Session } from "../session.js";
import {
  cachedChannels,
  cachedUser,
  ensureUsers,
  fetchChannelInfo,
  getCachedChannel,
  getChannels,
  refreshAllChannels,
  type ChannelMeta,
} from "./cache.js";

/** Slack channel ids start with C (public), G (private/mpim), or D (im), then uppercase alphanumerics. */
const ID_RE = /^[CGD][A-Z0-9]{6,}$/;

export function looksLikeId(arg: string): boolean {
  return ID_RE.test(arg);
}

/** Strip a leading `#` and surrounding whitespace from a channel argument. */
export function normalizeChannelArg(arg: string): string {
  return arg.trim().replace(/^#/, "");
}

/**
 * Resolve `#name`, bare `name`, or an id to a ChannelMeta. Cache-backed; on a name miss it refreshes
 * (member channels, then the whole workspace) before giving up with fuzzy suggestions. See
 * specs/behaviors/resolution-and-caching.md.
 */
export async function resolveChannel(session: Session, arg: string): Promise<ChannelMeta> {
  const raw = normalizeChannelArg(arg);

  if (looksLikeId(raw)) {
    const cached = getCachedChannel(session.teamId, raw);
    if (cached) return cached;
    try {
      return await fetchChannelInfo(session, raw);
    } catch {
      throw new AxiError(`Channel id '${raw}' not found or inaccessible`, "CHANNEL_NOT_FOUND", [
        "Run `slack-axi channels` to list your channels",
      ]);
    }
  }

  // Name lookup, refreshing the cache on a miss before failing.
  const target = raw.toLowerCase();
  let channels = await getChannels(session);
  let hit = channels.find((c) => c.name.toLowerCase() === target);
  if (!hit) {
    channels = await refreshAllChannels(session);
    channels = cachedChannels(session.teamId);
    hit = channels.find((c) => c.name.toLowerCase() === target);
  }
  if (hit) return hit;

  throw new AxiError(`Channel '${raw}' not found`, "CHANNEL_NOT_FOUND", [
    ...suggestionsFor(channels, target),
    "Run `slack-axi channels` to list your channels, or `--all` to include unjoined ones",
  ]);
}

function suggestionsFor(channels: ChannelMeta[], target: string): string[] {
  const matches = suggestChannels(channels, target, 5);
  return matches.length > 0 ? [`Did you mean: ${matches.map((c) => `#${c.name} (${c.id})`).join(", ")}`] : [];
}

function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/**
 * Lenient "did you mean" ranking for a not-found name: substring either direction scores highest,
 * otherwise shared-prefix length. Surfaces near-misses (`bid-rtd-xyz` → `bid-rtd-*`) that a strict
 * substring filter would miss.
 */
function suggestChannels(channels: ChannelMeta[], query: string, limit: number): ChannelMeta[] {
  const q = query.toLowerCase();
  const scored = channels
    .filter((c) => c.name)
    .map((c) => {
      const name = c.name.toLowerCase();
      const contains = name.includes(q) || q.includes(name);
      const score = (contains ? 1000 : 0) + commonPrefixLen(name, q);
      return { c, score };
    })
    .filter((s) => s.score >= 3)
    .sort((a, b) => b.score - a.score || a.c.name.length - b.c.name.length || a.c.name.localeCompare(b.c.name));
  return scored.slice(0, limit).map((s) => s.c);
}

/** Rank cached channels by name similarity to a query (substring/prefix), best first. */
export function fuzzyChannelMatches(channels: ChannelMeta[], query: string, limit: number): ChannelMeta[] {
  const q = query.toLowerCase();
  return channels
    .filter((c) => c.name && c.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp || a.name.length - b.name.length || a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

/** A human label for a user id (display name → real name → handle → id). Cache-backed. */
export async function userLabel(session: Session, id: string): Promise<string> {
  await ensureUsers(session);
  const u = cachedUser(session.teamId, id);
  if (!u) return id;
  return u.display_name || u.real_name || u.name || id;
}

/** A human label for a channel: `#name` for channels, `@user` for a DM, participants for a group DM. */
export async function channelLabel(session: Session, meta: ChannelMeta): Promise<string> {
  if (meta.type === "im") {
    const who = meta.user ? await userLabel(session, meta.user) : "unknown";
    return `@${who}`;
  }
  if (meta.type === "mpim") return parseMpimName(meta.name);
  return `#${meta.name}`;
}

/**
 * Slack names group DMs `mpdm-<handle>--<handle>--<handle>-1`, so participants are derivable from the
 * name with no API call. Falls back to the raw name if the pattern doesn't match.
 */
export function parseMpimName(name: string): string {
  const m = name.match(/^mpdm-(.+)-\d+$/);
  if (!m) return name || "(group dm)";
  return m[1].split("--").join(", ");
}
