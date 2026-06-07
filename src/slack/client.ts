import { WebClient } from "@slack/web-api";

/** A validated token plus the workspace/user metadata derived from auth.test. */
export interface TokenIdentity {
  teamId: string;
  teamName: string;
  userId: string;
  userName?: string;
  url?: string;
  scopes: string[];
}

/** Build a Slack Web API client for a token. The SDK handles tiered rate-limit retry. */
export function webClient(token: string): WebClient {
  return new WebClient(token, { retryConfig: { retries: 3 } });
}

/**
 * Validate a token via auth.test and capture granted scopes.
 *
 * Uses a direct fetch (not WebClient) because the granted scopes are returned in the
 * `x-oauth-scopes` response header, which we want alongside the body in a single call —
 * the reliable source for scope-coverage checks (see specs/behaviors/auth-and-workspaces.md).
 * Throws the raw Slack error code (string) on failure for the caller to translate.
 */
export async function validateToken(token: string): Promise<TokenIdentity> {
  const res = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
  });

  const scopes = (res.headers.get("x-oauth-scopes") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const body = (await res.json()) as {
    ok: boolean;
    error?: string;
    team?: string;
    team_id?: string;
    user?: string;
    user_id?: string;
    url?: string;
  };

  if (!body.ok) {
    // Throw the bare Slack error code; callers translate via slackErrorToAxi.
    throw Object.assign(new Error(body.error ?? "invalid_auth"), {
      data: { error: body.error ?? "invalid_auth" },
    });
  }

  return {
    teamId: body.team_id ?? "",
    teamName: body.team ?? "",
    userId: body.user_id ?? "",
    userName: body.user,
    url: body.url,
    scopes,
  };
}
