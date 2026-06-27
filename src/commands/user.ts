import { AxiError } from "axi-sdk-js";
import { takeFlag } from "../flags.js";
import { encodeObject, joinBlocks, renderHelp, renderList } from "../output.js";
import { activeSession, type Session } from "../session.js";
import { allCachedUsers, ensureUsers, fetchUserInfo, type UserMeta } from "../slack/cache.js";
import { resolveUserId } from "../slack/resolve.js";

export const USER_HELP = `usage: slack-axi user <id|@handle> [more...]
Looks up one or more users by id (U…/W…) or by @handle, resolving real/display name and whether each
is external (Slack Connect), a guest, or a bot. Resolves external/shared-channel members that the bulk
roster misses. Email/title appear only when the token holds the scope and the user exposes them.
examples:
  slack-axi user U01FMB233RS
  slack-axi user @chris U06UPJAECMS
  slack-axi user U024GAV5J U089E2499SM`;

/** Slack user ids are U… (humans/bots) or W… (Enterprise Grid), then uppercase alphanumerics. */
const USER_ID_RE = /^[UW][A-Z0-9]{6,}$/;

export async function userCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return USER_HELP;
  const team = takeFlag(args, "--team");
  const targets = team.rest.filter((a) => !a.startsWith("-"));
  if (targets.length === 0) {
    throw new AxiError("usage: slack-axi user <id|@handle> [more...]", "USAGE", [
      "Pass one or more user ids (U…) or @handles",
    ]);
  }

  const session = await activeSession({ teamFlag: team.value });
  await ensureUsers(session); // roster needed to resolve bare @handles
  const cache = allCachedUsers(session.teamId);

  const resolved: UserMeta[] = [];
  const unresolved: string[] = [];
  for (const target of targets) {
    const id = toUserId(session, target, cache);
    if (!id) {
      unresolved.push(target);
      continue;
    }
    // users.info gives the richest, freshest record (title, external flag, email when scoped) and is
    // the only path that resolves external/shared-channel ids absent from the roster.
    const meta = (await fetchUserInfo(session, id)) ?? cache[id];
    if (meta) resolved.push(meta);
    else unresolved.push(target);
  }

  if (resolved.length === 0) {
    throw new AxiError(`No user found for ${unresolved.join(", ")}`, "USER_NOT_FOUND", [
      "Pass a valid user id (U…) or an @handle from a channel you share",
    ]);
  }

  const rows = resolved.map((u) => buildRow(u));
  const hasTitle = rows.some((r) => r.title);
  const hasEmail = rows.some((r) => r.email);
  for (const r of rows) {
    if (hasTitle && !r.title) r.title = "";
    if (!hasTitle) delete r.title;
    if (hasEmail && !r.email) r.email = "";
    if (!hasEmail) delete r.email;
  }

  const help = [
    unresolved.length > 0 ? `Unresolved: ${unresolved.join(", ")}` : undefined,
    hasEmail ? undefined : "Email needs the `users:read.email` scope (and a user who exposes one)",
  ].filter((l): l is string => Boolean(l));

  return joinBlocks(
    encodeObject({ workspace: `${session.teamName ?? session.teamId} (${session.teamId})` }),
    renderList("users", rows, { total: resolved.length }),
    renderHelp(help),
  );
}

/** Map a `<id|@handle>` argument to a user id: ids pass through; handles resolve via the cached roster. */
function toUserId(
  session: Session,
  target: string,
  cache: Record<string, UserMeta>,
): string | undefined {
  if (USER_ID_RE.test(target)) return target;
  if (cache[target]) return target; // a raw id that isn't U/W-shaped but is cached
  const r = resolveUserId(session, target);
  return r.kind === "id" ? r.id : undefined;
}

function buildRow(u: UserMeta): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: u.id,
    name: u.real_name || u.name,
    display_name: u.display_name || "",
    kind: kindOf(u),
  };
  if (u.title) row.title = u.title;
  if (u.email) row.email = u.email;
  return row;
}

function kindOf(u: UserMeta): string {
  if (u.is_bot) return "bot";
  if (u.is_external) return "external";
  if (u.is_guest) return "guest";
  return "member";
}
