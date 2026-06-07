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
] as const;

/** Scopes needed for reactions + drafts (read + safe-draft capability set). */
export const WRITE_SCOPES = ["reactions:write", "chat:write"] as const;

export const REQUIRED_SCOPES: string[] = [...READ_SCOPES, ...WRITE_SCOPES];

/** Granted scopes missing from the required set. */
export function missingScopes(granted: string[]): string[] {
  const have = new Set(granted);
  return REQUIRED_SCOPES.filter((scope) => !have.has(scope));
}
