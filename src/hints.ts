/**
 * Hint text shared across commands, kept in one module so the wording stays consistent.
 * See specs/commands/auth.md → `auth login`.
 */

/**
 * The portable way to hand `auth login` a token without it landing in shell history or the process
 * list: read it silently, pipe it in, drop the variable.
 */
export function loginCommand(team?: string): string {
  return `read -rs T && printf %s "$T" | slack-axi auth login${team ? ` --team ${team}` : ""} --token-stdin; unset T`;
}

/** The `help[]` line pointing at `auth login`, optionally for one workspace. */
export function loginHint(team?: string): string {
  return `Run \`${loginCommand(team)}\` to store a token (paste it at the silent prompt)`;
}
