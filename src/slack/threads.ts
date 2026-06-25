import type { Session } from "../session.js";
import { type FileMeta, toFileMeta } from "./files.js";
import { type ReactionCount, toReactionCount } from "./reactions.js";
import { epochMsToTs, tsExclusiveBefore } from "./time.js";

/** A normalized Slack message (top-level or reply). */
export interface Msg {
  ts: string;
  user?: string;
  botId?: string;
  subtype?: string;
  text: string;
  replyCount: number;
  threadTs?: string;
  latestReply?: string;
  /** Counts only — the embedded reactor list is truncated, so we drop it here. See reactions.ts. */
  reactions?: ReactionCount[];
  /** Attachment metadata (no bytes); the `id` is the handle for `download`. See files.ts. */
  files?: FileMeta[];
}

export function isBot(msg: Msg): boolean {
  return Boolean(msg.botId) || msg.subtype === "bot_message";
}

function toMsg(raw: Record<string, unknown>): Msg {
  return {
    ts: String(raw.ts),
    ...(typeof raw.user === "string" ? { user: raw.user } : {}),
    ...(typeof raw.bot_id === "string" ? { botId: raw.bot_id } : {}),
    ...(typeof raw.subtype === "string" ? { subtype: raw.subtype } : {}),
    text: typeof raw.text === "string" ? raw.text : "",
    replyCount: typeof raw.reply_count === "number" ? raw.reply_count : 0,
    ...(typeof raw.thread_ts === "string" ? { threadTs: raw.thread_ts } : {}),
    ...(typeof raw.latest_reply === "string" ? { latestReply: raw.latest_reply } : {}),
    ...(Array.isArray(raw.reactions)
      ? { reactions: (raw.reactions as Record<string, unknown>[]).map(toReactionCount) }
      : {}),
    ...(Array.isArray(raw.files) && raw.files.length > 0
      ? { files: (raw.files as Record<string, unknown>[]).map(toFileMeta) }
      : {}),
  };
}

const byTsAsc = (a: Msg, b: Msg) => Number.parseFloat(a.ts) - Number.parseFloat(b.ts);

/**
 * All top-level messages in the half-open window `[oldestMs, endMs)`, paginated to completion, returned
 * oldest→newest regardless of the API's native page order. The upper bound is exclusive (`latest` is
 * one microsecond before `endMs`) so adjacent windows/batches tile with no gap and no overlap.
 * See specs/behaviors/time-and-completeness.md.
 */
export async function fetchWindow(session: Session, channelId: string, oldestMs: number, endMs: number): Promise<Msg[]> {
  const messages: Msg[] = [];
  let cursor: string | undefined;
  do {
    const res = await session.client.conversations.history({
      channel: channelId,
      oldest: epochMsToTs(oldestMs),
      latest: tsExclusiveBefore(endMs),
      inclusive: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    for (const m of res.messages ?? []) messages.push(toMsg(m as Record<string, unknown>));
    cursor = res.has_more ? res.response_metadata?.next_cursor || undefined : undefined;
  } while (cursor);
  return messages.sort(byTsAsc);
}

/** A whole thread (parent + replies), paginated to completion, oldest→newest. */
export async function fetchThread(session: Session, channelId: string, parentTs: string): Promise<Msg[]> {
  const messages: Msg[] = [];
  let cursor: string | undefined;
  do {
    const res = await session.client.conversations.replies({
      channel: channelId,
      ts: parentTs,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    for (const m of res.messages ?? []) messages.push(toMsg(m as Record<string, unknown>));
    cursor = res.has_more ? res.response_metadata?.next_cursor || undefined : undefined;
  } while (cursor);
  return messages.sort(byTsAsc);
}

/** Replies to a thread, excluding the parent. */
export async function fetchReplies(session: Session, channelId: string, parentTs: string): Promise<Msg[]> {
  return (await fetchThread(session, channelId, parentTs)).filter((m) => m.ts !== parentTs);
}
