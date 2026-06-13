import type { Session } from "../session.js";

/** A single emoji reaction with its complete reactor roster. `count` is always the true total. */
export interface Reaction {
  name: string;
  count: number;
  users: string[];
}

/** The message a reaction roster belongs to, with just enough context to cite it. */
export interface ReactedMessage {
  ts: string;
  user?: string;
  botId?: string;
  text: string;
  reactions: Reaction[];
}

/** A compact reaction with no roster — what rides inline on `read`/`thread` rows (counts only). */
export interface ReactionCount {
  name: string;
  count: number;
}

/** Normalize a raw Slack reaction object, keeping its complete `users` list. */
function toReaction(raw: Record<string, unknown>): Reaction {
  return {
    name: typeof raw.name === "string" ? raw.name : "",
    count: typeof raw.count === "number" ? raw.count : 0,
    users: Array.isArray(raw.users) ? raw.users.filter((u): u is string => typeof u === "string") : [],
  };
}

/** Normalize just the counts from a raw reaction — drops the embedded (truncated) `users` list. */
export function toReactionCount(raw: Record<string, unknown>): ReactionCount {
  return {
    name: typeof raw.name === "string" ? raw.name : "",
    count: typeof raw.count === "number" ? raw.count : 0,
  };
}

/**
 * The complete reactor roster for one message, via `reactions.get` with `full=true` — the only source
 * Slack guarantees returns every reactor (the `users` array embedded in `conversations.history` is
 * truncated). Returns `null` when the channel/ts resolves to no message.
 * See specs/behaviors/reactions.md.
 */
export async function fetchReactions(session: Session, channelId: string, ts: string): Promise<ReactedMessage | null> {
  const res = await session.client.reactions.get({ channel: channelId, timestamp: ts, full: true });
  const msg = res.message as Record<string, unknown> | undefined;
  if (!msg) return null;
  const rawReactions = Array.isArray(msg.reactions) ? (msg.reactions as Record<string, unknown>[]) : [];
  return {
    ts: typeof msg.ts === "string" ? msg.ts : ts,
    ...(typeof msg.user === "string" ? { user: msg.user } : {}),
    ...(typeof msg.bot_id === "string" ? { botId: msg.bot_id } : {}),
    text: typeof msg.text === "string" ? msg.text : "",
    reactions: rawReactions.map(toReaction),
  };
}

/**
 * Order reactions for the full roster view: count descending, ties keeping native (input) order.
 * Pure + stable so it's unit-testable without a live call.
 */
export function orderReactions<T extends ReactionCount>(reactions: T[]): T[] {
  return reactions
    .map((r, i) => [r, i] as const)
    .sort((a, b) => b[0].count - a[0].count || a[1] - b[1])
    .map(([r]) => r);
}

/**
 * The inline counts-only summary for a `read`/`thread` row: `:heart:×12 :eyes:×3`, space-joined, in
 * Slack's native reaction order. Empty input → `""`. The raw Slack name (incl. skin-tone suffixes like
 * `+1::skin-tone-3`) is preserved verbatim between colons. See specs/behaviors/reactions.md.
 */
export function summarizeReactions(reactions: ReactionCount[]): string {
  return reactions.map((r) => `:${r.name}:×${r.count}`).join(" ");
}
