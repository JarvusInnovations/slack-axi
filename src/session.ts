import type { WebClient } from "@slack/web-api";
import { isMode, type Mode, resolveActiveToken } from "./config.js";
import { validateToken, webClient } from "./slack/client.js";
import { toAxiError } from "./slack/errors.js";

/** An authenticated, ready-to-use Slack session for one workspace. */
export interface Session {
  token: string;
  teamId: string;
  teamName?: string;
  /** The authenticated user's id — surfaced so read-surface output can state whose view it reflects. */
  userId?: string;
  userName?: string;
  /** Bot identity (`B…`) when the token is a bot token; its messages carry this as `bot_id`. */
  botId?: string;
  /** Outgoing-rendering mode, when known from the stored record. See resolveMode(). */
  mode?: Mode;
  client: WebClient;
}

/**
 * The mode outgoing text is rendered in: `SLACK_AXI_MODE` for this run, else the workspace record's
 * (override or derived), else derived from the token's identity. See specs/behaviors/mrkdwn.md.
 */
export async function resolveMode(session: Session): Promise<Mode> {
  const env = process.env.SLACK_AXI_MODE;
  if (isMode(env)) return env;
  if (session.mode) return session.mode;
  const identity = await ensureIdentity(session);
  session.mode = identity.botId ? "bot" : "human";
  return session.mode;
}

/** The identity a token's writes act as. See specs/commands/write.md → The token's identity. */
export interface Identity {
  userId?: string;
  botId?: string;
}

/**
 * The session's identity, resolving it with a single `auth.test` when the token came from the
 * environment with no stored record (so `userId` is unknown). Cached on the session.
 */
export async function ensureIdentity(session: Session): Promise<Identity> {
  if (!session.userId) {
    try {
      const identity = await validateToken(session.token);
      session.userId = identity.userId;
      session.userName = session.userName ?? identity.userName;
      session.botId = session.botId ?? identity.botId;
    } catch (err) {
      throw toAxiError(err, { team: session.teamId });
    }
  }
  return { userId: session.userId, botId: session.botId };
}

/**
 * Resolve the active workspace into a usable session. teamId is guaranteed: for a stored token it
 * comes from token.json; for a bare SLACK_AXI_TOKEN env (no SLACK_AXI_TEAM) it's derived via a single
 * auth.test. The teamId is the cache key, so it must be known before any read.
 */
export async function activeSession(
  options: { teamFlag?: string; mutation?: boolean } = {},
): Promise<Session> {
  const active = resolveActiveToken(options);
  let teamId = active.teamId;
  let teamName = active.teamName;
  let userId = active.userId;
  let userName = active.userName;
  let botId = active.botId;
  if (!teamId) {
    try {
      const identity = await validateToken(active.token);
      teamId = identity.teamId;
      teamName = identity.teamName;
      userId = userId ?? identity.userId;
      userName = userName ?? identity.userName;
      botId = botId ?? identity.botId;
    } catch (err) {
      throw toAxiError(err, options.teamFlag ? { team: options.teamFlag } : {});
    }
  }
  return {
    token: active.token,
    teamId,
    teamName,
    userId,
    userName,
    botId,
    mode: active.mode,
    client: webClient(active.token),
  };
}
