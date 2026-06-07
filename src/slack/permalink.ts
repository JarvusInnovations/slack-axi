import type { Session } from "../session.js";

/**
 * The canonical permalink for a message, via chat.getPermalink (handles thread replies and the
 * workspace subdomain automatically). slack-axi owns this — the agent never assembles a permalink.
 * See specs/behaviors/permalinks.md.
 */
export async function getPermalink(session: Session, channel: string, ts: string): Promise<string> {
  const res = await session.client.chat.getPermalink({ channel, message_ts: ts });
  return typeof res.permalink === "string" ? res.permalink : "";
}
