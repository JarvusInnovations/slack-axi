import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cacheChannelsPath, cacheUsersPath } from "../config.js";
import type { Session } from "../session.js";

export type ChannelType = "public" | "private" | "mpim" | "im";

export interface ChannelMeta {
  id: string;
  /** Channel name (no leading #). For `im` this is empty; use `user` to resolve a label. */
  name: string;
  type: ChannelType;
  is_member: boolean;
  is_archived: boolean;
  /** For `im` channels: the other participant's user id. */
  user?: string;
  topic?: string;
  purpose?: string;
}

export interface UserMeta {
  id: string;
  name: string;
  real_name?: string;
  display_name?: string;
  is_bot: boolean;
  /** True for Slack Connect / shared-channel members from another workspace. */
  is_external?: boolean;
  /** True for multi-channel or single-channel guests (restricted accounts). */
  is_guest?: boolean;
  /** Present only when the token holds `users:read.email` and the user exposes one. */
  email?: string;
  title?: string;
}

interface ChannelsCache {
  fetched_at: number;
  channels: Record<string, ChannelMeta>;
}

interface UsersCache {
  fetched_at: number;
  users: Record<string, UserMeta>;
  /** Ids that `users.info` couldn't resolve, with the epoch ms of the failed lookup (negative cache). */
  misses?: Record<string, number>;
}

/** Cache freshness window. Caches only map id↔name; message content is always fetched live. */
export const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Negative-cache window for unresolvable user ids. Shorter than the positive TTL so a user who joins
 * (or whose Slack Connect membership becomes visible) gets re-tried soon rather than staying
 * `(unresolved)` for an hour. `cache refresh` clears it outright.
 */
export const USER_MISS_TTL_MS = 15 * 60 * 1000;

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function now(): number {
  return Date.now();
}

// ---------------------------------------------------------------------------- channels

function classify(c: Record<string, unknown>): ChannelType {
  if (c.is_im) return "im";
  if (c.is_mpim) return "mpim";
  if (c.is_private) return "private";
  return "public";
}

function toChannelMeta(c: Record<string, unknown>): ChannelMeta {
  const topic = (c.topic as { value?: string } | undefined)?.value;
  const purpose = (c.purpose as { value?: string } | undefined)?.value;
  return {
    id: String(c.id),
    name: typeof c.name === "string" ? c.name : "",
    type: classify(c),
    is_member: c.is_member === true,
    is_archived: c.is_archived === true,
    ...(typeof c.user === "string" ? { user: c.user } : {}),
    ...(topic ? { topic } : {}),
    ...(purpose ? { purpose } : {}),
  };
}

function loadChannels(teamId: string): ChannelsCache {
  return readJson<ChannelsCache>(cacheChannelsPath(teamId)) ?? { fetched_at: 0, channels: {} };
}

function saveChannels(teamId: string, cache: ChannelsCache): void {
  writeJson(cacheChannelsPath(teamId), cache);
}

/** Merge freshly-fetched channels into the cache (newer entries win). */
function mergeChannels(teamId: string, fresh: ChannelMeta[]): ChannelMeta[] {
  const cache = loadChannels(teamId);
  for (const ch of fresh) cache.channels[ch.id] = ch;
  cache.fetched_at = now();
  saveChannels(teamId, cache);
  return fresh;
}

/** Fetch the user's conversations across ALL types (paginate to completion) and update the cache. */
export async function refreshMemberChannels(session: Session): Promise<ChannelMeta[]> {
  const result: ChannelMeta[] = [];
  let cursor: string | undefined;
  do {
    const res = await session.client.users.conversations({
      types: "public_channel,private_channel,mpim,im",
      exclude_archived: false,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    for (const c of res.channels ?? []) result.push(toChannelMeta({ ...c, is_member: true }));
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return mergeChannels(session.teamId, result);
}

/** Fetch every public+private channel in the workspace (paginate to completion) and update the cache. */
export async function refreshAllChannels(session: Session): Promise<ChannelMeta[]> {
  const result: ChannelMeta[] = [];
  let cursor: string | undefined;
  do {
    const res = await session.client.conversations.list({
      types: "public_channel,private_channel",
      exclude_archived: false,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    for (const c of res.channels ?? []) result.push(toChannelMeta(c as Record<string, unknown>));
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return mergeChannels(session.teamId, result);
}

/** All cached channels, refreshing member channels first if the cache is stale or empty. */
export async function getChannels(session: Session): Promise<ChannelMeta[]> {
  const cache = loadChannels(session.teamId);
  if (now() - cache.fetched_at > CACHE_TTL_MS || Object.keys(cache.channels).length === 0) {
    await refreshMemberChannels(session);
  }
  return Object.values(loadChannels(session.teamId).channels);
}

export function cachedChannels(teamId: string): ChannelMeta[] {
  return Object.values(loadChannels(teamId).channels);
}

export function getCachedChannel(teamId: string, id: string): ChannelMeta | undefined {
  return loadChannels(teamId).channels[id];
}

/** Fetch a single channel by id via conversations.info and cache it. */
export async function fetchChannelInfo(session: Session, id: string): Promise<ChannelMeta> {
  const res = await session.client.conversations.info({ channel: id });
  const [meta] = mergeChannels(session.teamId, [
    toChannelMeta(res.channel as Record<string, unknown>),
  ]);
  return meta;
}

// ---------------------------------------------------------------------------- users

export function toUserMeta(u: Record<string, unknown>, teamId: string): UserMeta {
  const profile =
    (u.profile as
      | { real_name?: string; display_name?: string; email?: string; title?: string }
      | undefined) ?? {};
  // Slack Connect members carry a `team_id` that differs from the active workspace; `users.list`
  // omits them entirely, which is why they only surface via the on-demand `users.info` fallback.
  // `is_stranger` is NOT reliably set for them (it's false for verified Connect members), so the
  // team_id mismatch is the load-bearing signal — see plan 10.
  const userTeam = typeof u.team_id === "string" ? u.team_id : undefined;
  const isExternal = u.is_stranger === true || (userTeam !== undefined && userTeam !== teamId);
  const isGuest = u.is_restricted === true || u.is_ultra_restricted === true;
  return {
    id: String(u.id),
    name: typeof u.name === "string" ? u.name : String(u.id),
    ...(profile.real_name ? { real_name: profile.real_name } : {}),
    ...(profile.display_name ? { display_name: profile.display_name } : {}),
    is_bot: u.is_bot === true,
    ...(isExternal ? { is_external: true } : {}),
    ...(isGuest ? { is_guest: true } : {}),
    ...(profile.email ? { email: profile.email } : {}),
    ...(profile.title ? { title: profile.title } : {}),
  };
}

function loadUsers(teamId: string): UsersCache {
  return readJson<UsersCache>(cacheUsersPath(teamId)) ?? { fetched_at: 0, users: {} };
}

function saveUsers(teamId: string, cache: UsersCache): void {
  writeJson(cacheUsersPath(teamId), cache);
}

/** Fetch the full user directory (paginate to completion) and replace the users cache. */
export async function refreshUsers(session: Session): Promise<void> {
  const users: Record<string, UserMeta> = {};
  let cursor: string | undefined;
  do {
    const res = await session.client.users.list({ limit: 200, ...(cursor ? { cursor } : {}) });
    for (const u of res.members ?? []) {
      const meta = toUserMeta(u as Record<string, unknown>, session.teamId);
      users[meta.id] = meta;
    }
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  saveUsers(session.teamId, { fetched_at: now(), users });
}

/** Ensure the users cache is populated and fresh. */
export async function ensureUsers(session: Session): Promise<void> {
  const cache = loadUsers(session.teamId);
  if (now() - cache.fetched_at > CACHE_TTL_MS || Object.keys(cache.users).length === 0) {
    await refreshUsers(session);
  }
}

export function cachedUser(teamId: string, id: string): UserMeta | undefined {
  return loadUsers(teamId).users[id];
}

/** The whole users map (one file read) — for labeling many messages without repeated reads. */
export function allCachedUsers(teamId: string): Record<string, UserMeta> {
  return loadUsers(teamId).users;
}

/** Resolve a single id via `users.info` (the one-id-per-call fallback for ids absent from the roster). */
export async function fetchUserInfo(session: Session, id: string): Promise<UserMeta | null> {
  try {
    const res = await session.client.users.info({ user: id });
    if (!res.user) return null;
    return toUserMeta(res.user as Record<string, unknown>, session.teamId);
  } catch {
    return null;
  }
}

/**
 * Hydrate the users cache with any of `ids` it's missing, via per-id `users.info` lookups. This is the
 * fallback that resolves external Slack Connect / shared-channel / guest authors, who never appear in
 * the bulk `users.list` roster. Lookups are deduped, run concurrently, and cached both positively
 * (resolved → users) and negatively (unresolvable → misses, short TTL) so a cold channel pays each id
 * once. Idempotent and cheap on a warm cache. Call once before rendering, then label synchronously
 * from `allCachedUsers`. See specs/behaviors/resolution-and-caching.md and plan 10.
 */
export async function ensureUsersByIds(session: Session, ids: Iterable<string>): Promise<void> {
  await ensureUsers(session); // base roster loaded/fresh first; a full refresh also clears stale misses
  const cache = loadUsers(session.teamId);
  const misses = cache.misses ?? {};
  const at = now();
  const need = [...new Set(ids)].filter(
    (id) =>
      id && !cache.users[id] && !(misses[id] !== undefined && at - misses[id] < USER_MISS_TTL_MS),
  );
  if (need.length === 0) return;

  const fetched = await Promise.all(
    need.map(async (id) => [id, await fetchUserInfo(session, id)] as const),
  );
  for (const [id, meta] of fetched) {
    if (meta) delete misses[id];
    else misses[id] = at;
    if (meta) cache.users[id] = meta;
  }
  cache.misses = misses;
  saveUsers(session.teamId, cache);
}
