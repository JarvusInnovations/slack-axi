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
}

interface ChannelsCache {
  fetched_at: number;
  channels: Record<string, ChannelMeta>;
}

interface UsersCache {
  fetched_at: number;
  users: Record<string, UserMeta>;
}

/** Cache freshness window. Caches only map id↔name; message content is always fetched live. */
export const CACHE_TTL_MS = 60 * 60 * 1000;

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
  const [meta] = mergeChannels(session.teamId, [toChannelMeta(res.channel as Record<string, unknown>)]);
  return meta;
}

// ---------------------------------------------------------------------------- users

function toUserMeta(u: Record<string, unknown>): UserMeta {
  const profile = (u.profile as { real_name?: string; display_name?: string } | undefined) ?? {};
  return {
    id: String(u.id),
    name: typeof u.name === "string" ? u.name : String(u.id),
    ...(profile.real_name ? { real_name: profile.real_name } : {}),
    ...(profile.display_name ? { display_name: profile.display_name } : {}),
    is_bot: u.is_bot === true,
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
      const meta = toUserMeta(u as Record<string, unknown>);
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
