import { AxiError } from "axi-sdk-js";
import { takeBool, takeFlag } from "../flags.js";
import { encodeBlock, joinBlocks, renderHelp, renderList, truncate } from "../output.js";
import { activeSession, type Session } from "../session.js";
import {
  cachedChannels,
  ensureUsers,
  getChannels,
  refreshAllChannels,
  type ChannelMeta,
  type ChannelType,
} from "../slack/cache.js";
import { channelLabel, fuzzyChannelMatches, resolveChannel, userLabel } from "../slack/resolve.js";

export const CHANNELS_HELP = `usage: slack-axi channels [flags]
Lists the conversations you belong to across ALL types (public, private, group DMs, DMs).
flags[5]:
  --type <t>     Filter: public | private | mpim | im
  --all          List every public+private channel in the workspace (not just yours)
  --match <q>    Fuzzy-filter by name
  --limit <n>    Max rows to show (default 50)
  --fields <a,b> Extra columns: is_member, topic, purpose
examples:
  slack-axi channels
  slack-axi channels --type private
  slack-axi channels --match proj
  slack-axi channels --all --match proj`;

const DEFAULT_CHANNEL_LIMIT = 50;
const DEFAULT_DM_LIMIT = 50;
const DEFAULT_MEMBER_LIMIT = 100;

function parseLimit(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const DMS_HELP = `usage: slack-axi dms
Lists your direct messages (im) and group DMs (mpim) with participant names resolved.`;

export const MEMBERS_HELP = `usage: slack-axi members <channel>
Lists the members of a channel (#name, name, or id), names resolved.`;

const TYPE_ORDER: Record<ChannelType, number> = { public: 0, private: 1, mpim: 2, im: 3 };

export async function channelsCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return CHANNELS_HELP;
  const team = takeFlag(args, "--team");
  const all = takeBool(team.rest, "--all");
  const type = takeFlag(all.rest, "--type");
  const match = takeFlag(type.rest, "--match");
  const limitFlag = takeFlag(match.rest, "--limit");
  const fields = takeFlag(limitFlag.rest, "--fields");
  const limit = parseLimit(limitFlag.value, DEFAULT_CHANNEL_LIMIT);
  const extra = (fields.value ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const session = await activeSession({ teamFlag: team.value });

  let pool: ChannelMeta[];
  if (all.present) {
    await refreshAllChannels(session);
    pool = cachedChannels(session.teamId).filter((c) => c.type === "public" || c.type === "private");
  } else {
    pool = (await getChannels(session)).filter((c) => c.is_member);
  }

  const total = pool.length;
  let filtered = pool;
  if (type.value) {
    if (!["public", "private", "mpim", "im"].includes(type.value)) {
      throw new AxiError(`Unknown --type '${type.value}'`, "USAGE", ["Use one of: public, private, mpim, im"]);
    }
    filtered = filtered.filter((c) => c.type === type.value);
  }
  if (match.value) filtered = fuzzyChannelMatches(filtered, match.value, filtered.length);

  if (filtered.length === 0) {
    const why = match.value ? ` matching "${match.value}"` : type.value ? ` of type ${type.value}` : "";
    return joinBlocks(
      encodeBlock("channels", `0 channels${why} (of ${total} ${all.present ? "workspace" : "your"} channels)`),
      renderHelp(all.present ? [] : ["Run `slack-axi channels --all` to include channels you haven't joined"]),
    );
  }

  // Resolve labels (im → @user) once, then sort by type group then name.
  await ensureUsers(session);
  const labeled = await Promise.all(
    filtered.map(async (c) => ({ meta: c, label: await channelLabel(session, c) })),
  );
  labeled.sort((a, b) => TYPE_ORDER[a.meta.type] - TYPE_ORDER[b.meta.type] || a.label.localeCompare(b.label));

  const matched = filtered.length;
  const capped = labeled.slice(0, limit);
  const rows = capped.map(({ meta, label }) => {
    const row: Record<string, unknown> = { id: meta.id, name: label, type: meta.type };
    if (all.present || extra.includes("is_member")) row.is_member = meta.is_member;
    if (extra.includes("topic")) row.topic = meta.topic ? truncate(meta.topic, 120) : "";
    if (extra.includes("purpose")) row.purpose = meta.purpose ? truncate(meta.purpose, 120) : "";
    return row;
  });

  const help = [
    "Run `slack-axi read <channel>` to read one (threads inlined)",
    match.value ? undefined : "Narrow with `--match <q>` or `--type public|private|mpim|im`",
    capped.length < matched ? `Showing ${capped.length} of ${matched}; raise with \`--limit <n>\`` : undefined,
    all.present ? "Drop `--all` to list just your channels" : "Add `--all` to include channels you haven't joined",
  ].filter((l): l is string => Boolean(l));

  return joinBlocks(
    encodeBlock("workspace", `${session.teamName ?? session.teamId} (${session.teamId})`),
    renderList("channels", rows, { total: matched }),
    renderHelp(help),
  );
}

export async function dmsCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return DMS_HELP;
  const team = takeFlag(args, "--team");
  const limitFlag = takeFlag(team.rest, "--limit");
  const limit = parseLimit(limitFlag.value, DEFAULT_DM_LIMIT);
  const session = await activeSession({ teamFlag: team.value });

  const dms = (await getChannels(session)).filter((c) => c.is_member && (c.type === "im" || c.type === "mpim"));
  if (dms.length === 0) return encodeBlock("dms", "0 direct or group-DM conversations");

  // Sort cheaply (im first, then by id) and cap BEFORE resolving labels.
  dms.sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.id.localeCompare(b.id));
  const capped = dms.slice(0, limit);

  await ensureUsers(session); // for im labels; mpim participants come from the channel name (no calls)
  const rows = await Promise.all(
    capped.map(async (c) => ({ id: c.id, type: c.type, with: await channelLabel(session, c) })),
  );

  const help = [
    "Run `slack-axi read <id>` to read a DM thread",
    capped.length < dms.length ? `Showing ${capped.length} of ${dms.length}; raise with \`--limit <n>\`` : undefined,
  ].filter((l): l is string => Boolean(l));

  return joinBlocks(
    encodeBlock("workspace", `${session.teamName ?? session.teamId} (${session.teamId})`),
    renderList("dms", rows, { total: dms.length }),
    renderHelp(help),
  );
}

export async function membersCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return MEMBERS_HELP;
  const team = takeFlag(args, "--team");
  const limitFlag = takeFlag(team.rest, "--limit");
  const limit = parseLimit(limitFlag.value, DEFAULT_MEMBER_LIMIT);
  const target = limitFlag.rest.find((a) => !a.startsWith("-"));
  if (!target) throw new AxiError("usage: slack-axi members <channel> [--limit <n>]", "USAGE", []);

  const session = await activeSession({ teamFlag: team.value });
  const channel = await resolveChannel(session, target);
  const ids = await listMembers(session, channel.id);
  if (ids.length === 0) return encodeBlock("members", `0 members in ${await channelLabel(session, channel)}`);

  await ensureUsers(session);
  const labeled = await Promise.all(ids.map(async (id) => ({ user: id, name: await userLabel(session, id) })));
  labeled.sort((a, b) => a.name.localeCompare(b.name));
  const rows = labeled.slice(0, limit);

  const help =
    rows.length < labeled.length
      ? [`Showing ${rows.length} of ${labeled.length} members; raise with \`--limit <n>\``]
      : [];
  return joinBlocks(
    encodeBlock("channel", `${await channelLabel(session, channel)} (${channel.id})`),
    renderList("members", rows, { total: labeled.length }),
    renderHelp(help),
  );
}

/** Channel member ids, paginated to completion. */
async function listMembers(session: Session, channel: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await session.client.conversations.members({ channel, limit: 200, ...(cursor ? { cursor } : {}) });
    ids.push(...(res.members ?? []));
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return ids;
}
