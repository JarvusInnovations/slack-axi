import { AxiError } from "axi-sdk-js";

/**
 * Translate a Slack API error code into a structured AxiError with an actionable suggestion.
 * See specs/behaviors/errors.md. Raw Slack/SDK payloads never reach the agent.
 */
export function slackErrorToAxi(code: string, context: { team?: string; channel?: string } = {}): AxiError {
  const teamFlag = context.team ? ` --team ${context.team}` : "";
  switch (code) {
    case "invalid_auth":
    case "token_revoked":
    case "token_expired":
    case "account_inactive":
      return new AxiError(
        "Slack token is invalid or revoked",
        "AUTH_INVALID",
        [`Run \`slack-axi auth login${teamFlag} --token xoxp-...\` to store a valid token`],
      );
    case "not_authed":
      return new AxiError(
        "No Slack token was supplied",
        "NO_TOKEN",
        ["Set SLACK_AXI_TOKEN or run `slack-axi auth login`"],
      );
    case "missing_scope":
      return new AxiError(
        "Token is missing a required scope",
        "SCOPE_MISSING",
        ["Re-run `slack-axi auth setup`, add the missing scope, and re-install the app"],
      );
    case "channel_not_found":
      return new AxiError(
        context.channel ? `Channel '${context.channel}' not found` : "Channel not found",
        "CHANNEL_NOT_FOUND",
        [
          "Run `slack-axi channels` to list your channels",
          "Or `slack-axi search channels <query>` to find one by name",
        ],
      );
    case "not_in_channel":
      return new AxiError(
        context.channel ? `You are not a member of '${context.channel}'` : "Not a member of that channel",
        "NOT_IN_CHANNEL",
        ["Join the channel in Slack, or use `slack-axi channels --all` to confirm the id"],
      );
    case "thread_not_found":
    case "message_not_found":
      return new AxiError(
        "Message or thread not found",
        "MESSAGE_NOT_FOUND",
        ["Check the ts; run `slack-axi read <channel>` to find the message"],
      );
    case "file_not_found":
    case "file_deleted":
      return new AxiError(
        "File not found",
        "FILE_NOT_FOUND",
        ["Check the file id from a `read`/`thread` files column; it may have been deleted"],
      );
    case "ratelimited":
      return new AxiError(
        "Slack rate limit exceeded after retries",
        "RATE_LIMITED",
        ["Wait a moment and retry; narrow the time window or lower --limit"],
      );
    default:
      return new AxiError(
        `Slack API error: ${code}`,
        "SLACK_ERROR",
        ["Run `slack-axi doctor` to check auth and scopes"],
      );
  }
}

/** Coerce an unknown thrown value (incl. @slack/web-api errors) into an AxiError. */
export function toAxiError(err: unknown, context: { team?: string; channel?: string } = {}): AxiError {
  if (err instanceof AxiError) return err;
  const code = extractSlackErrorCode(err);
  if (code) return slackErrorToAxi(code, context);
  const message = err instanceof Error ? err.message : String(err);
  return new AxiError(`Unexpected error: ${message}`, "INTERNAL_ERROR", [
    "Run `slack-axi doctor` to check auth and runtime health",
  ]);
}

function extractSlackErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const data = (err as { data?: { error?: unknown } }).data;
  if (data && typeof data.error === "string") return data.error;
  return undefined;
}
