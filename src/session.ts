import type { WebClient } from "@slack/web-api";
import { resolveActiveToken } from "./config.js";
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
  client: WebClient;
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
  if (!teamId) {
    try {
      const identity = await validateToken(active.token);
      teamId = identity.teamId;
      teamName = identity.teamName;
      userId = userId ?? identity.userId;
      userName = userName ?? identity.userName;
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
    client: webClient(active.token),
  };
}
