/** User-token scopes slack-axi needs. See specs/behaviors/auth-and-workspaces.md. */

export const READ_SCOPES = [
  "channels:read",
  "groups:read",
  "im:read",
  "mpim:read",
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "search:read",
  "users:read",
  "reactions:read",
  "files:read",
] as const;

/** Scopes needed for reactions + drafts, including draft attachments (`files:write`). */
export const WRITE_SCOPES = ["reactions:write", "chat:write", "files:write"] as const;

export const REQUIRED_SCOPES: string[] = [...READ_SCOPES, ...WRITE_SCOPES];

/** Granted scopes missing from the required set. */
export function missingScopes(granted: string[]): string[] {
  const have = new Set(granted);
  return REQUIRED_SCOPES.filter((scope) => !have.has(scope));
}

/**
 * The fix for missing scopes on an app that already exists: add them to the app's User Token Scopes
 * and reinstall it. Slack keeps the same token across a scope-adding reinstall, so no `auth login` is
 * needed — granted scopes are read live from `auth.test`. See specs/behaviors/auth-and-workspaces.md.
 */
export function addScopesHelp(
  missing: readonly string[],
  options: { bot?: boolean } = {},
): string[] {
  const list = missing.length > 0 ? missing.map((s) => `\`${s}\``).join(", ") : "the missing scope";
  const kind = options.bot ? "Bot" : "User";
  return [
    `Add ${list} under ${kind} Token Scopes on the app's OAuth & Permissions page (https://api.slack.com/apps), then click Reinstall to Workspace`,
    "The token stays the same, so there is no need to log in again; re-run `slack-axi doctor` to confirm",
  ];
}
