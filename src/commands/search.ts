import { AxiError } from "axi-sdk-js";
import { takeBool, takeFlag } from "../flags.js";
import { encodeObject, joinBlocks, renderHelp, renderList, truncate } from "../output.js";
import { activeSession } from "../session.js";
import { allCachedUsers, ensureUsers } from "../slack/cache.js";
import { formatText } from "../slack/format.js";
import { looksLikeId, normalizeChannelArg, resolveChannel } from "../slack/resolve.js";
import { handle } from "../slack/ts.js";
import { DEFAULT_TZ, formatDate, formatDateTime, parseSpanMs, tsToEpochMs } from "../slack/time.js";

export const SEARCH_HELP = `usage: slack-axi search "<query>" [flags]
Finds messages across the workspace (search.messages). Use this to FIND a thing — to read a channel
over a time window completely, use \`read <channel> --from --to\` instead.
flags[6]:
  --in <channel>   Limit to a channel (#name or id)
  --from <@user>   Limit to a sender
  --after <when>   On/after a date (2026-05-01) or span (7d)
  --before <when>  On/before a date or span
  --limit <n>      Max matches (default 20)
  --cite           Add a permalink column
examples:
  slack-axi search "proposal loss"
  slack-axi search "token refresh" --in #eng --after 2026-05-01
  slack-axi search "deploy" --from @alice`;

const DEFAULT_LIMIT = 20;

export async function searchCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return SEARCH_HELP;

  const team = takeFlag(args, "--team");
  const inFlag = takeFlag(team.rest, "--in");
  const fromFlag = takeFlag(inFlag.rest, "--from");
  const after = takeFlag(fromFlag.rest, "--after");
  const before = takeFlag(after.rest, "--before");
  const limitFlag = takeFlag(before.rest, "--limit");
  const citeFlag = takeBool(limitFlag.rest, "--cite");
  const cite = citeFlag.present;
  const positional = citeFlag.rest.filter((a) => !a.startsWith("-"));
  const query = positional.join(" ").trim();
  if (!query) {
    throw new AxiError('usage: slack-axi search "<query>" [flags]', "USAGE", [
      'Pass a search query, e.g. slack-axi search "proposal loss"',
    ]);
  }

  const limit = limitFlag.value ? Number.parseInt(limitFlag.value, 10) : DEFAULT_LIMIT;
  const session = await activeSession({ teamFlag: team.value });
  const tz = DEFAULT_TZ;

  // Translate friendly flags into Slack search modifiers.
  const parts = [query];
  if (inFlag.value) parts.push(`in:#${await channelNameFor(session, inFlag.value)}`);
  if (fromFlag.value) parts.push(`from:${fromFlag.value.startsWith("@") ? fromFlag.value : `@${fromFlag.value}`}`);
  if (after.value) parts.push(`after:${toSearchDate(after.value, tz)}`);
  if (before.value) parts.push(`before:${toSearchDate(before.value, tz)}`);
  const fullQuery = parts.join(" ");

  let res;
  try {
    res = await session.client.search.messages({
      query: fullQuery,
      count: Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT,
      sort: "timestamp",
    });
  } catch (err) {
    // search.messages requires the user-only search:read scope.
    const code = (err as { data?: { error?: string } })?.data?.error;
    if (code === "missing_scope") {
      throw new AxiError("Token is missing the search:read scope", "SCOPE_MISSING", [
        "Re-run `slack-axi auth setup`, add search:read, re-install the app, then `auth login`",
      ]);
    }
    throw err;
  }

  const matches = res.messages?.matches ?? [];
  const total = res.messages?.total ?? matches.length;
  if (matches.length === 0) {
    return joinBlocks(
      encodeObject({ workspace: `${session.teamName ?? session.teamId} (${session.teamId})`, query: fullQuery }),
      encodeObject({ matches: `0 matches for "${fullQuery}"` }),
      renderHelp(["Broaden the query, or use `slack-axi read <channel> --from --to` to sweep a window"]),
    );
  }

  await ensureUsers(session);
  const users = allCachedUsers(session.teamId);
  const rows = matches.map((m) => {
    const ts = String(m.ts ?? "");
    const ch = m.channel as { id?: string; name?: string } | undefined;
    const row: Record<string, unknown> = {
      channel: ch?.name ? `#${ch.name} (${ch.id})` : (ch?.id ?? "?"),
      author: m.username || (m.user ? `@${m.user}` : "(unknown)"),
      when: m.ts ? formatDateTime(tsToEpochMs(ts), tz) : "",
      text: truncate(formatText(typeof m.text === "string" ? m.text : "", users)),
      ts: handle(ts),
    };
    if (cite && typeof m.permalink === "string") row.permalink = m.permalink;
    return row;
  });

  const help = [
    "To read a result's channel over a window completely, use `slack-axi read <channel> --from <date> --to <date>`",
    rows.length < total ? `Showing ${rows.length} of ${total}; raise with \`--limit <n>\`` : undefined,
    !cite ? "Add `--cite` (or run `slack-axi cite <channel> <ts>`) for permalinks to cite" : undefined,
  ].filter((l): l is string => Boolean(l));

  return joinBlocks(
    encodeObject({ workspace: `${session.teamName ?? session.teamId} (${session.teamId})`, query: fullQuery }),
    renderList("matches", rows, { total }),
    renderHelp(help),
  );
}

/** Resolve a `--in` channel argument to its bare name for the `in:#name` modifier. */
async function channelNameFor(session: Awaited<ReturnType<typeof activeSession>>, arg: string): Promise<string> {
  if (looksLikeId(arg)) {
    const ch = await resolveChannel(session, arg);
    return ch.name || arg;
  }
  return normalizeChannelArg(arg);
}

/** Slack `after:`/`before:` take a YYYY-MM-DD date; accept a date passthrough or a relative span. */
function toSearchDate(when: string, tz: string): string {
  const span = parseSpanMs(when);
  if (span !== undefined) return formatDate(Date.now() - span, tz);
  const date = /^(\d{4}-\d{2}-\d{2})/.exec(when.trim());
  return date ? date[1] : when;
}
