import { AxiError } from "axi-sdk-js";
import { takeBool, takeFlag } from "../flags.js";
import { encodeObject, joinBlocks, renderHelp, renderList, truncate } from "../output.js";
import { activeSession, type Session } from "../session.js";
import { allCachedUsers, ensureUsers, getChannels, type ChannelMeta, type UserMeta } from "../slack/cache.js";
import { formatText, userName } from "../slack/format.js";
import { getPermalink } from "../slack/permalink.js";
import { channelLabel, resolveChannel } from "../slack/resolve.js";
import { fetchWindow, isBot, type Msg } from "../slack/threads.js";
import { formatDateTime, formatRange, resolveWindow, tsToEpochMs } from "../slack/time.js";
import { handle } from "../slack/ts.js";

export const CATCHUP_HELP = `usage: slack-axi catchup [flags]
Sweeps a SCOPED set of channels over a time window and returns everything posted — a multi-channel read.
Slack has no cross-conversation history endpoint, so this fans out per channel; scope keeps it bounded.
flags[9]:
  --since <span>      Window ending now: 1d, 12h, 90m (default: 1d)
  --from <when>       Window start (date / datetime / span); --to end (default now)
  --tz <zone>         Timezone (default America/New_York)
  --type <a,b>        Conversation types to sweep (default: public,private)
  --match <q>         Only channels whose name contains <q>
  --in <c1,c2,...>    Explicit channel list (#name/name/id), overrides --type/--match
  --limit-per <n>     Max messages per channel (default 50)
  --max-channels <n>  Refuse to sweep more than this many (default 40)
  --exclude-bots      Drop bot/automation messages
  --cite              Add a permalink column
Threads are not inlined here (kept cheap across many channels); a [+N replies] note marks threads —
expand one with \`read <channel>\` or \`thread <channel> <ts>\`.
examples:
  slack-axi catchup --since 1d --match bid
  slack-axi catchup --from 2026-06-06T09:00 --in bid-rtd-analytics,transit-lake`;

const DEFAULT_MAX_CHANNELS = 40;
const DEFAULT_LIMIT_PER = 50;

export async function catchupCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return CATCHUP_HELP;

  const team = takeFlag(args, "--team");
  const since = takeFlag(team.rest, "--since");
  const from = takeFlag(since.rest, "--from");
  const to = takeFlag(from.rest, "--to");
  const tz = takeFlag(to.rest, "--tz");
  const type = takeFlag(tz.rest, "--type");
  const match = takeFlag(type.rest, "--match");
  const inList = takeFlag(match.rest, "--in");
  const limitPer = takeFlag(inList.rest, "--limit-per");
  const maxCh = takeFlag(limitPer.rest, "--max-channels");
  const excludeBots = takeBool(maxCh.rest, "--exclude-bots");
  const cite = takeBool(excludeBots.rest, "--cite");

  const perCap = posInt(limitPer.value, DEFAULT_LIMIT_PER);
  const maxChannels = posInt(maxCh.value, DEFAULT_MAX_CHANNELS);

  const session = await activeSession({ teamFlag: team.value });
  // Default window for a catch-up is the last day, not the read default of 7d.
  const window = resolveWindow(
    { since: since.value ?? (from.value || to.value ? undefined : "1d"), from: from.value, to: to.value, tz: tz.value },
    Date.now(),
  );

  const pool = await resolveScope(session, { inList: inList.value, type: type.value, match: match.value });
  if (pool.length === 0) {
    return joinBlocks(
      encodeObject({ workspace: ws(session), range: formatRange(window) }),
      encodeObject({ channels: "0 channels matched the scope" }),
      renderHelp(["Broaden with `--type public,private,mpim,im` or `--match <q>`, or pass `--in <list>`"]),
    );
  }
  if (pool.length > maxChannels) {
    throw new AxiError(
      `Scope matched ${pool.length} channels; that's above --max-channels (${maxChannels})`,
      "TOO_MANY_CHANNELS",
      [
        "Narrow with `--match <q>` or `--type`, or pass an explicit `--in <c1,c2,...>`",
        `Or raise the cap: --max-channels ${pool.length}`,
      ],
    );
  }

  await ensureUsers(session);
  const users = allCachedUsers(session.teamId);

  // Sequential sweep to respect Slack's tightened conversations.history rate limits.
  const active: Array<{ channel: ChannelMeta; label: string; total: number; rows: Array<Record<string, unknown>> }> = [];
  for (const channel of pool) {
    let msgs = await fetchWindow(session, channel.id, window.oldestMs, window.latestMs);
    if (excludeBots.present) msgs = msgs.filter((m) => !isBot(m));
    if (msgs.length === 0) continue;
    const total = msgs.length;
    const shown = msgs.slice(-perCap);
    const rows: Array<Record<string, unknown>> = [];
    for (const m of shown) rows.push(await buildRow(session, channel.id, m, users, window.tz, cite.present));
    active.push({ channel, label: await channelLabel(session, channel), total, rows });
  }

  const header = encodeObject({
    workspace: ws(session),
    range: formatRange(window),
    swept: `${pool.length} channels (${active.length} with activity)`,
  });

  const blocks = [header];
  for (const a of active) {
    const incomplete = a.rows.length < a.total ? ` (most recent ${a.rows.length} of ${a.total}; raise --limit-per)` : "";
    blocks.push(`${a.label} (${a.channel.id})${incomplete}:\n${indentLines(renderList("messages", a.rows), 2)}`);
  }

  const help = [
    active.length > 0 ? "Use `slack-axi read <channel> --from --to` or `thread <channel> <ts>` to expand" : "Nothing posted in this window across the scoped channels",
    !cite.present ? "Add `--cite`, or `slack-axi cite <channel> <ts...>`, for permalinks" : undefined,
  ].filter((l): l is string => Boolean(l));

  return joinBlocks(...blocks, renderHelp(help));
}

async function resolveScope(
  session: Session,
  opts: { inList?: string; type?: string; match?: string },
): Promise<ChannelMeta[]> {
  if (opts.inList) {
    const names = opts.inList.split(",").map((s) => s.trim()).filter(Boolean);
    return Promise.all(names.map((n) => resolveChannel(session, n)));
  }
  const types = (opts.type ?? "public,private").split(",").map((s) => s.trim()).filter(Boolean);
  let pool = (await getChannels(session)).filter((c) => c.is_member && types.includes(c.type));
  if (opts.match) {
    const q = opts.match.toLowerCase();
    pool = pool.filter((c) => c.name.toLowerCase().includes(q));
  }
  return pool;
}

async function buildRow(
  session: Session,
  channelId: string,
  msg: Msg,
  users: Record<string, UserMeta>,
  tz: string,
  cite: boolean,
): Promise<Record<string, unknown>> {
  const author = msg.user ? userName(msg.user, users) : msg.botId ? "(bot)" : "(system)";
  const replyNote = msg.replyCount > 0 ? ` [+${msg.replyCount} repl${msg.replyCount === 1 ? "y" : "ies"}]` : "";
  const row: Record<string, unknown> = {
    time: formatDateTime(tsToEpochMs(msg.ts), tz),
    author,
    text: truncate(formatText(msg.text, users)) + replyNote,
    ts: handle(msg.ts),
  };
  if (cite) row.permalink = await getPermalink(session, channelId, msg.ts);
  return row;
}

function ws(session: Session): string {
  return `${session.teamName ?? session.teamId} (${session.teamId})`;
}

function posInt(value: string | undefined, fallback: number): number {
  const n = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function indentLines(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text.split("\n").map((line) => (line.length > 0 ? pad + line : line)).join("\n");
}
