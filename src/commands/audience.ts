import { AxiError } from "axi-sdk-js";
import { isLongFlag, takeBool, takeFlag } from "../flags.js";
import { encodeBlock, joinBlocks, renderHelp, renderList } from "../output.js";
import { activeSession, type Session } from "../session.js";
import { toAxiError } from "../slack/errors.js";
import {
  looksLikeId,
  normalizeChannelArg,
  parseMpimName,
  resolveChannel,
} from "../slack/resolve.js";
import { addScopesHelp } from "../slack/scopes.js";

/**
 * `audience <channel>` — who can read a conversation: its sharing flags plus a breakdown of its
 * members' account types. All live (auth.test, conversations.info, conversations.members, users.info);
 * nothing cached. See specs/commands/audience.md.
 */

export const DEFAULT_MAX_MEMBERS = 200;

export const AUDIENCE_HELP = `usage: slack-axi audience <channel> [flags]
Reports who can read a conversation: its sharing flags (is_shared, is_ext_shared, is_org_shared,
is_pending_ext_shared) and its members by account type: full, guests, external (another organization),
other_workspace (same Enterprise org), deactivated, bots, unresolved. Counts are exclusive and add up
to members_checked. Live from Slack; needs channels:read/groups:read/im:read/mpim:read + users:read.
flags[4]:
  --members          List every checked member with its flags (instead of only the non-full ones)
  --max-members <n>  Members to page and look up (default ${DEFAULT_MAX_MEMBERS}); past it, truncated: true
  --team <id>        Workspace to use
  --help
examples:
  slack-axi audience C0123ABCD
  slack-axi audience #proj-shared --members
  slack-axi audience D0123ABCD`;

const PAGE_SIZE = 200;
const LOOKUP_CONCURRENCY = 8;
const VALID_FLAGS = "--members, --max-members <n>, --team <id> (--help always allowed)";

export type ConversationKind = "channel" | "private" | "im" | "mpim";

export type MemberCategory =
  | "unresolved"
  | "deactivated"
  | "external"
  | "other_workspace"
  | "bot"
  | "guest"
  | "full";

/** Display order: non-full first, most consequential first. */
const CATEGORY_ORDER: MemberCategory[] = [
  "external",
  "other_workspace",
  "guest",
  "unresolved",
  "bot",
  "deactivated",
  "full",
];

export interface AudienceMember {
  id: string;
  name: string;
  category: MemberCategory;
  why: string;
  team: string;
  guest: "single" | "multi" | "";
  external: boolean;
  bot: boolean;
  deactivated: boolean;
}

export interface AudienceReport {
  teamId: string;
  conversation: {
    id: string;
    name: string;
    kind: ConversationKind;
    is_member?: boolean;
    is_shared: boolean;
    is_ext_shared: boolean;
    is_org_shared: boolean;
    is_pending_ext_shared: boolean;
    num_members?: number;
    user?: string;
  };
  checked: number;
  /** The number listed when complete; num_members (or undefined if unknown) when truncated. */
  total?: number;
  truncated: boolean;
  members: AudienceMember[];
}

// ---------------------------------------------------------------------------- command

export async function audienceCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return AUDIENCE_HELP;
  const team = takeFlag(args, "--team");
  const list = takeBool(team.rest, "--members");
  const max = takeFlag(list.rest, "--max-members");
  const unknown = max.rest.find((a) => isLongFlag(a) || /^-[A-Za-z]/.test(a));
  if (unknown) {
    throw new AxiError(`Unknown flag ${unknown} for \`audience\``, "USAGE", [
      `Valid flags for \`audience\`: ${VALID_FLAGS}`,
    ]);
  }
  if (max.rest.length !== 1) {
    throw new AxiError(
      max.rest.length === 0
        ? "audience needs a channel"
        : `audience takes one channel, got ${max.rest.length}`,
      "USAGE",
      ["usage: slack-axi audience <channel> [--members] [--max-members <n>] [--team <id>]"],
    );
  }
  const maxMembers = parseMaxMembers(max.value);

  const session = await activeSession({ teamFlag: team.value });
  const raw = normalizeChannelArg(max.rest[0]);
  const channelId = looksLikeId(raw) ? raw : (await resolveChannel(session, raw)).id;
  const report = await collectAudience(session, channelId, { maxMembers });
  return renderAudience(session, report, { members: list.present, team: team.value });
}

export function parseMaxMembers(value: string | undefined): number {
  if (value === undefined) return DEFAULT_MAX_MEMBERS;
  if (!/^\d+$/.test(value) || Number.parseInt(value, 10) < 1) {
    throw new AxiError(`--max-members must be a positive integer, got '${value}'`, "USAGE", [
      `Pass e.g. \`--max-members 500\` (default ${DEFAULT_MAX_MEMBERS})`,
    ]);
  }
  return Number.parseInt(value, 10);
}

// ---------------------------------------------------------------------------- data

interface SlackError {
  code: string;
  needed?: string;
}

function slackError(err: unknown): SlackError | undefined {
  if (!err || typeof err !== "object") return undefined;
  const data = (err as { data?: { error?: unknown; needed?: unknown } }).data;
  if (!data || typeof data.error !== "string") return undefined;
  return {
    code: data.error,
    ...(typeof data.needed === "string" && data.needed ? { needed: data.needed } : {}),
  };
}

const KIND_SCOPE: Record<ConversationKind, string> = {
  channel: "channels:read",
  private: "groups:read",
  im: "im:read",
  mpim: "mpim:read",
};

/** The read scope(s) a conversation id could need before conversations.info has told us its kind. */
function scopesForId(id: string): string[] {
  if (id.startsWith("D")) return ["im:read"];
  if (id.startsWith("G")) return ["groups:read", "mpim:read"];
  return ["channels:read", "groups:read", "mpim:read"];
}

function isBotSession(session: Session, botId?: string): boolean {
  return Boolean(botId || session.botId || session.token.startsWith("xoxb-"));
}

function scopeError(scopes: string[], bot: boolean): AxiError {
  const list = scopes.map((s) => `\`${s}\``).join(" or ");
  return new AxiError(
    `Token is missing the ${list} scope`,
    "SCOPE_MISSING",
    addScopesHelp(scopes, { bot }),
  );
}

function notFound(channel: string, bot: boolean): AxiError {
  return new AxiError(
    `Conversation '${channel}' not found, or it is private and this token is not a member`,
    "CHANNEL_NOT_FOUND",
    [
      "Run `slack-axi channels` to list your conversations (or `--all` for unjoined channels)",
      bot
        ? "If it is a private channel, invite the bot to it in Slack"
        : "If it is private, ask a member to add you",
    ],
  );
}

function notInChannel(channel: string, bot: boolean): AxiError {
  return new AxiError(
    `Conversation '${channel}' exists, but this token cannot read its members`,
    "NOT_IN_CHANNEL",
    [
      bot
        ? "Invite the bot to the conversation in Slack, then re-run"
        : "Join the conversation in Slack, then re-run",
    ],
  );
}

function kindOf(c: Record<string, unknown>): ConversationKind {
  if (c.is_im) return "im";
  if (c.is_mpim) return "mpim";
  if (c.is_private) return "private";
  return "channel";
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export function classifyMember(
  u: Record<string, unknown>,
  ctx: { teamId: string; enterpriseId?: string },
): AudienceMember {
  const profile = (u.profile as { real_name?: string; display_name?: string } | undefined) ?? {};
  const id = String(u.id);
  const name =
    profile.real_name ||
    (typeof u.real_name === "string" ? u.real_name : "") ||
    profile.display_name ||
    (typeof u.name === "string" ? u.name : "") ||
    id;
  const team = typeof u.team_id === "string" ? u.team_id : "";
  const userEnterprise = (u.enterprise_user as { enterprise_id?: unknown } | undefined)
    ?.enterprise_id;
  const otherTeam = team !== "" && team !== ctx.teamId;
  const sameOrg =
    Boolean(ctx.enterpriseId) &&
    typeof userEnterprise === "string" &&
    userEnterprise === ctx.enterpriseId;
  const stranger = u.is_stranger === true;
  const external = stranger || (otherTeam && !sameOrg);
  const guest: AudienceMember["guest"] =
    u.is_ultra_restricted === true ? "single" : u.is_restricted === true ? "multi" : "";
  const bot = u.is_bot === true || id === "USLACKBOT";
  const deactivated = u.deleted === true;

  let category: MemberCategory;
  let why: string;
  if (deactivated) {
    category = "deactivated";
    why = "deactivated";
  } else if (external) {
    category = "external";
    why = otherTeam ? `other organization (team ${team})` : "stranger";
  } else if (otherTeam) {
    category = "other_workspace";
    why = `same org, other workspace (team ${team})`;
  } else if (bot) {
    category = "bot";
    why = "bot";
  } else if (guest) {
    category = "guest";
    why = guest === "single" ? "single-channel guest" : "multi-channel guest";
  } else {
    category = "full";
    why = "";
  }
  return { id, name, category, why, team, guest, external, bot, deactivated };
}

function unresolvedMember(id: string, code: string): AudienceMember {
  return {
    id,
    name: id,
    category: "unresolved",
    why: `unresolved (${code})`,
    team: "",
    guest: "",
    external: false,
    bot: false,
    deactivated: false,
  };
}

/** Gather the audience of one conversation. Throws structured AxiErrors; never returns partial data. */
export async function collectAudience(
  session: Session,
  channelId: string,
  options: { maxMembers: number },
): Promise<AudienceReport> {
  // 1. The token's own workspace + Enterprise org, live.
  let auth: { team_id?: string; enterprise_id?: string; bot_id?: string };
  try {
    auth = (await session.client.auth.test()) as typeof auth;
  } catch (err) {
    throw toAxiError(err, { team: session.teamId });
  }
  const teamId = auth.team_id || session.teamId;
  const enterpriseId = auth.enterprise_id || undefined;
  const bot = isBotSession(session, auth.bot_id);

  // 2. The conversation and its sharing flags.
  let info: Record<string, unknown>;
  try {
    const res = await session.client.conversations.info({
      channel: channelId,
      include_num_members: true,
    });
    info = (res.channel ?? {}) as Record<string, unknown>;
  } catch (err) {
    const e = slackError(err);
    if (e?.code === "channel_not_found") throw notFound(channelId, bot);
    if (e?.code === "missing_scope")
      throw scopeError(e.needed ? [e.needed] : scopesForId(channelId), bot);
    if (
      e?.code === "not_in_channel" ||
      e?.code === "no_permission" ||
      e?.code === "channel_is_limited_access"
    )
      throw notInChannel(channelId, bot);
    throw toAxiError(err, { team: session.teamId, channel: channelId });
  }
  const kind = kindOf(info);
  const numMembers = typeof info.num_members === "number" ? info.num_members : undefined;

  // 3. Member ids, paged up to the bound.
  const ids: string[] = [];
  let truncated = false;
  let cursor: string | undefined;
  try {
    do {
      const res = await session.client.conversations.members({
        channel: channelId,
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      });
      ids.push(...(res.members ?? []));
      cursor = res.response_metadata?.next_cursor || undefined;
      if (ids.length >= options.maxMembers) {
        truncated = ids.length > options.maxMembers || Boolean(cursor);
        ids.length = Math.min(ids.length, options.maxMembers);
        break;
      }
    } while (cursor);
  } catch (err) {
    const e = slackError(err);
    if (e?.code === "missing_scope") throw scopeError([e.needed ?? KIND_SCOPE[kind]], bot);
    if (
      e?.code === "channel_not_found" ||
      e?.code === "not_in_channel" ||
      e?.code === "no_permission"
    )
      throw notInChannel(channelId, bot);
    throw toAxiError(err, { team: session.teamId, channel: channelId });
  }

  // 4. Each member's account, live.
  const members = await pool(ids, LOOKUP_CONCURRENCY, async (id) => {
    try {
      const res = await session.client.users.info({ user: id });
      if (!res.user) return unresolvedMember(id, "user_not_found");
      return classifyMember(res.user as Record<string, unknown>, { teamId, enterpriseId });
    } catch (err) {
      const e = slackError(err);
      if (e?.code === "user_not_found" || e?.code === "user_not_visible")
        return unresolvedMember(id, e.code);
      if (e?.code === "missing_scope") throw scopeError([e.needed ?? "users:read"], bot);
      throw toAxiError(err, { team: session.teamId });
    }
  });

  let name: string;
  if (kind === "im") {
    const other = members.find((m) => m.id === info.user);
    name = `@${other && other.category !== "unresolved" ? other.name : String(info.user ?? "unknown")}`;
  } else if (kind === "mpim") {
    name = parseMpimName(typeof info.name === "string" ? info.name : "");
  } else {
    name = `#${typeof info.name === "string" ? info.name : channelId}`;
  }

  return {
    teamId,
    conversation: {
      id: typeof info.id === "string" ? info.id : channelId,
      name,
      kind,
      ...(typeof info.is_member === "boolean" ? { is_member: info.is_member } : {}),
      is_shared: info.is_shared === true,
      is_ext_shared: info.is_ext_shared === true,
      is_org_shared: info.is_org_shared === true,
      is_pending_ext_shared: info.is_pending_ext_shared === true,
      ...(numMembers !== undefined ? { num_members: numMembers } : {}),
      ...(kind === "im" && typeof info.user === "string" ? { user: info.user } : {}),
    },
    checked: members.length,
    total: truncated
      ? numMembers !== undefined && numMembers > ids.length
        ? numMembers
        : undefined
      : members.length,
    truncated,
    members,
  };
}

// ---------------------------------------------------------------------------- render

function sortMembers(members: AudienceMember[]): AudienceMember[] {
  return [...members].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      a.name.localeCompare(b.name),
  );
}

export function renderAudience(
  session: Pick<Session, "teamName" | "teamId">,
  report: AudienceReport,
  options: { members?: boolean; team?: string } = {},
): string {
  const count = (c: MemberCategory) => report.members.filter((m) => m.category === c).length;
  const total = report.total !== undefined ? String(report.total) : `more than ${report.checked}`;
  const audience = {
    members_checked: `${report.checked} of ${total}`,
    truncated: report.truncated,
    full: count("full"),
    guests: count("guest"),
    external: count("external"),
    other_workspace: count("other_workspace"),
    deactivated: count("deactivated"),
    bots: count("bot"),
    unresolved: count("unresolved"),
  };

  const sorted = sortMembers(report.members);
  const nonFull = sorted.filter((m) => m.category !== "full");
  let listBlock: string;
  if (options.members) {
    listBlock =
      sorted.length === 0
        ? encodeBlock("members", "0 members checked")
        : renderList(
            "members",
            sorted.map((m) => ({
              id: m.id,
              name: m.name,
              category: m.category,
              team: m.team,
              guest: m.guest,
              external: m.external,
              bot: m.bot,
              deactivated: m.deactivated,
            })),
          );
  } else {
    listBlock =
      nonFull.length === 0
        ? encodeBlock(
            "non_full_members",
            report.checked === 0
              ? "0 (no members checked)"
              : "0 (every checked member is a full member of this workspace)",
          )
        : renderList(
            "non_full_members",
            nonFull.map((m) => ({ id: m.id, name: m.name, why: m.why })),
          );
  }

  const teamFlag = options.team ? ` --team ${options.team}` : "";
  const help = [
    report.truncated
      ? `Checked ${report.checked} of ${total} members; raise with \`slack-axi audience ${report.conversation.id} --max-members <n>${teamFlag}\``
      : undefined,
    !options.members && nonFull.length > 0
      ? "Add `--members` to list every member with its flags"
      : undefined,
  ].filter((l): l is string => Boolean(l));

  return joinBlocks(
    encodeBlock("workspace", `${session.teamName ?? session.teamId} (${session.teamId})`),
    encodeBlock("conversation", report.conversation),
    encodeBlock("audience", audience),
    listBlock,
    renderHelp(help),
  );
}
