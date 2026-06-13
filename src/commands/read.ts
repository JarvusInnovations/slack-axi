import { AxiError } from "axi-sdk-js";
import { takeBool, takeFlag } from "../flags.js";
import { encodeObject, joinBlocks, renderHelp, renderList, truncate } from "../output.js";
import { activeSession, type Session } from "../session.js";
import { allCachedUsers, ensureUsers, type UserMeta } from "../slack/cache.js";
import { formatText, userName } from "../slack/format.js";
import { getPermalink } from "../slack/permalink.js";
import { summarizeReactions } from "../slack/reactions.js";
import { channelLabel, resolveChannel } from "../slack/resolve.js";
import { fetchReplies, fetchThread, fetchWindow, isBot, type Msg } from "../slack/threads.js";
import { formatDate, formatDateTime, formatRange, formatTime, resolveWindow, tsToEpochMs } from "../slack/time.js";
import { dottedTs, handle } from "../slack/ts.js";

export const READ_HELP = `usage: slack-axi read <channel> [flags]
Reads a channel over a time window, threads inlined, paginated to completion.
flags[8]:
  --since <span>   Relative window ending now: 7d, 24h, 90m (default: 7d)
  --from <when>    Window start: date (2026-04-23), datetime (2026-04-23T14:00), or span
  --to <when>      Window end (default: now)
  --tz <zone>      Timezone for parsing + display (default: America/New_York)
  --limit <n>      Max top-level messages to show (default: 50)
  --threads <m>    full | summary | none (default: full)
  --exclude-bots   Drop bot/automation messages
  --cite           Add a permalink column (for bulk citation); else use ts + \`cite\`
  --full           Don't truncate message text
examples:
  slack-axi read #general
  slack-axi read #eng --from 2026-04-23 --to 2026-04-29
  slack-axi read #eng --since 24h --threads summary`;

export const THREAD_HELP = `usage: slack-axi thread <channel> <ts>
Reads a single thread fully (parent + all replies), names + permalinks resolved.`;

const DEFAULT_LIMIT = 50;

type ThreadMode = "full" | "summary" | "none";

export async function readCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return READ_HELP;
  const f = parseReadFlags(args);
  if (!f.channel) throw new AxiError("usage: slack-axi read <channel> [flags]", "USAGE", []);

  const session = await activeSession({ teamFlag: f.team });
  const channel = await resolveChannel(session, f.channel);
  const window = resolveWindow({ since: f.since, from: f.from, to: f.to, tz: f.tz }, Date.now());

  let parents = await fetchWindow(session, channel.id, window.oldestMs, window.endMs);
  let botFiltered = 0;
  if (f.excludeBots) {
    const before = parents.length;
    parents = parents.filter((m) => !isBot(m));
    botFiltered = before - parents.length;
  }

  const label = await channelLabel(session, channel);
  const header: Record<string, unknown> = {
    workspace: `${session.teamName ?? session.teamId} (${session.teamId})`,
    channel: `${label} (${channel.id}, ${channel.type})`,
    range: formatRange(window),
  };

  if (parents.length === 0) {
    header.messages = `0 messages in ${label} between ${formatDate(window.oldestMs, window.tz)} and ${formatDate(window.endMs - 1, window.tz)} (${window.tz})`;
    return joinBlocks(
      encodeObject(header),
      renderHelp(["Widen the window with `--since 30d` or `--from <date>`"]),
    );
  }

  const total = parents.length;
  const complete = total <= f.limit;
  const displayed = complete ? parents : parents.slice(-f.limit);

  await ensureUsers(session);
  const users = allCachedUsers(session.teamId);

  // Build date-grouped blocks: each displayed parent followed by its inlined replies (a thread is a unit).
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const parent of displayed) {
    const date = formatDate(tsToEpochMs(parent.ts), window.tz);
    const rows = groups.get(date) ?? [];
    rows.push(await buildRow(session, channel.id, parent, users, window.tz, f, false));

    if (parent.replyCount > 0 && f.threads === "full") {
      const replies = await fetchReplies(session, channel.id, parent.ts);
      for (const r of replies) rows.push(await buildRow(session, channel.id, r, users, window.tz, f, true));
    } else if (parent.replyCount > 0 && f.threads === "summary") {
      rows.push({ time: "", author: "", text: `↳ ${parent.replyCount} repl${parent.replyCount === 1 ? "y" : "ies"} (use \`thread ${channel.id} ${parent.ts}\`)`, ts: "" });
    }
    groups.set(date, rows);
  }

  header.messages = `${displayed.length} of ${total} top-level (threads inlined below)`;
  header.complete = complete;
  if (botFiltered > 0) header.bot_filtered = botFiltered;

  // Reactions ride inline as a counts-only column, auto-when-present: only added if some row has a
  // reaction, and then uniform across every row (empty for those with none) so the compact TOON table
  // is preserved. See specs/behaviors/reactions.md.
  const allRows = [...groups.values()].flat();
  const anyReactions = fillReactionColumn(allRows);

  const blocks: string[] = [encodeObject(header)];
  for (const [date, rows] of groups) blocks.push(`${date}:\n${indentLines(renderList("messages", rows), 2)}`);

  const help = [
    f.threads !== "full" ? `Run \`slack-axi thread ${channel.id} <ts>\` to expand a thread` : undefined,
    anyReactions ? `Run \`slack-axi reactions ${channel.id} <ts>\` to see who reacted` : undefined,
    !complete ? `Showing the most recent ${f.limit} of ${total}; raise \`--limit <n>\` or narrow the window` : undefined,
    !f.cite ? `Run \`slack-axi cite ${channel.id} <ts...>\` for permalinks to messages you cite` : undefined,
  ].filter((l): l is string => Boolean(l));

  return joinBlocks(...blocks, renderHelp(help));
}

export async function threadCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return THREAD_HELP;
  const team = takeFlag(args, "--team");
  const full = takeBool(team.rest, "--full");
  const positional = full.rest.filter((a) => !a.startsWith("-"));
  const [target, ts] = positional;
  if (!target || !ts) throw new AxiError("usage: slack-axi thread <channel> <ts>", "USAGE", []);

  const session = await activeSession({ teamFlag: team.value });
  const channel = await resolveChannel(session, target);
  const msgs = await fetchThread(session, channel.id, dottedTs(ts));
  if (msgs.length === 0) throw new AxiError("Thread not found", "MESSAGE_NOT_FOUND", ["Check the ts and channel"]);

  await ensureUsers(session);
  const users = allCachedUsers(session.teamId);
  const tz = "America/New_York";
  const rows = await Promise.all(
    msgs.map(async (m, i) => {
      const row: Record<string, unknown> = {
        time: formatDateTime(tsToEpochMs(m.ts), tz),
        author: authorName(m, users),
        text: (i === 0 ? "" : "↳ ") + (full.present ? formatText(m.text, users) : truncate(formatText(m.text, users))),
        ts: handle(m.ts),
        permalink: await getPermalink(session, channel.id, m.ts),
      };
      if (m.reactions && m.reactions.length > 0) row.reactions = summarizeReactions(m.reactions);
      return row;
    }),
  );
  const anyReactions = fillReactionColumn(rows);

  return joinBlocks(
    encodeObject({ channel: `${await channelLabel(session, channel)} (${channel.id})`, replies: msgs.length - 1 }),
    renderList("messages", rows),
    anyReactions ? renderHelp([`Run \`slack-axi reactions ${channel.id} <ts>\` to see who reacted`]) : "",
  );
}

// ---------------------------------------------------------------------------- helpers

interface ReadFlags {
  team?: string;
  channel?: string;
  since?: string;
  from?: string;
  to?: string;
  tz?: string;
  limit: number;
  threads: ThreadMode;
  excludeBots: boolean;
  cite: boolean;
  full: boolean;
}

function parseReadFlags(args: string[]): ReadFlags {
  const team = takeFlag(args, "--team");
  const since = takeFlag(team.rest, "--since");
  const from = takeFlag(since.rest, "--from");
  const to = takeFlag(from.rest, "--to");
  const tz = takeFlag(to.rest, "--tz");
  const limit = takeFlag(tz.rest, "--limit");
  const threads = takeFlag(limit.rest, "--threads");
  const excludeBots = takeBool(threads.rest, "--exclude-bots");
  const cite = takeBool(excludeBots.rest, "--cite");
  const full = takeBool(cite.rest, "--full");
  const channel = full.rest.find((a) => !a.startsWith("-"));
  const mode = (threads.value ?? "full") as ThreadMode;
  if (!["full", "summary", "none"].includes(mode)) {
    throw new AxiError(`Invalid --threads '${threads.value}'`, "USAGE", ["Use: full | summary | none"]);
  }
  const lim = limit.value ? Number.parseInt(limit.value, 10) : DEFAULT_LIMIT;
  return {
    team: team.value,
    channel,
    since: since.value,
    from: from.value,
    to: to.value,
    tz: tz.value,
    limit: Number.isFinite(lim) && lim > 0 ? lim : DEFAULT_LIMIT,
    threads: mode,
    excludeBots: excludeBots.present,
    cite: cite.present,
    full: full.present,
  };
}

async function buildRow(
  session: Session,
  channelId: string,
  msg: Msg,
  users: Record<string, UserMeta>,
  tz: string,
  f: ReadFlags,
  reply: boolean,
): Promise<Record<string, unknown>> {
  const text = formatText(msg.text, users);
  // Replies can fall on a later day than their parent (the thread is grouped under the parent's date),
  // so reply rows carry a full date+time to stay unambiguous; parents show just the time-of-day.
  const epoch = tsToEpochMs(msg.ts);
  const row: Record<string, unknown> = {
    time: reply ? formatDateTime(epoch, tz) : formatTime(epoch, tz),
    author: authorName(msg, users),
    text: (reply ? "↳ " : "") + (f.full ? text : truncate(text)),
    ts: handle(msg.ts),
  };
  if (f.cite) row.permalink = await getPermalink(session, channelId, msg.ts);
  if (msg.reactions && msg.reactions.length > 0) row.reactions = summarizeReactions(msg.reactions);
  return row;
}

/**
 * Make the inline reactions column uniform (auto-when-present): if any row carries a `reactions`
 * summary, ensure every row has the key (empty string when it had none), appended last so the TOON
 * table stays compact. Returns whether the column was applied. See specs/behaviors/reactions.md.
 */
function fillReactionColumn(rows: Array<Record<string, unknown>>): boolean {
  const any = rows.some((r) => typeof r.reactions === "string" && r.reactions.length > 0);
  if (!any) {
    // Drop any stray empty key so a reaction-free view shows no column at all.
    for (const r of rows) delete r.reactions;
    return false;
  }
  for (const r of rows) if (typeof r.reactions !== "string") r.reactions = "";
  return true;
}

function authorName(msg: Msg, users: Record<string, UserMeta>): string {
  if (msg.user) return userName(msg.user, users);
  if (msg.botId) return "(bot)";
  return "(system)";
}

function indentLines(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}
