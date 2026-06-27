import { AxiError } from "axi-sdk-js";
import { takeBool, takeFlag, takeFlags } from "../flags.js";
import { encodeObject, joinBlocks, renderHelp, renderList, truncate } from "../output.js";
import { activeSession, type Session } from "../session.js";
import {
  allCachedUsers,
  ensureUsers,
  getCachedChannel,
  getChannels,
  type UserMeta,
} from "../slack/cache.js";
import { formatText, userName } from "../slack/format.js";
import {
  looksLikeId,
  normalizeChannelArg,
  resolveChannel,
  resolveUserId,
} from "../slack/resolve.js";
import { handle } from "../slack/ts.js";
import { DEFAULT_TZ, formatDate, formatDateTime, parseSpanMs, tsToEpochMs } from "../slack/time.js";

export const SEARCH_HELP = `usage: slack-axi search "<query>" [flags]
Finds messages (or files) across every conversation you belong to. Exhaustive by default: sweeps ALL
matches, oldest→newest, and declares completeness. To read a channel over a window completely, use
\`read <channel> --from --to\` instead.
flags[13]:
  --files          Search files/attachments instead of messages
  --in <channel>   Limit to a channel (#name or id)
  --from <@user>   Limit to a sender (bare name resolved to an exact id)
  --with <@user>   Limit to conversations that include this person (any sender)
  --to <@user>     Limit to messages directed at this person
  --has <x>        Require content: link | file | pin | reaction | :emoji: (repeatable)
  --is <x>         Filter state: thread | pinned | saved (repeatable)
  --after <when>   On/after a date (2026-05-01) or span (7d)
  --before <when>  On/before a date or span
  --on <date>      Exactly on a date;  --during <2026-05|2026>  within a month/year
  --type <t>       Keep only public | private | mpim | im conversations (post-filter)
  --limit <n>      Cap matches (default: all); raise/lower to bound the sweep
  --cite           Add a permalink column (matches already carry one)
examples:
  slack-axi search "proposal loss"
  slack-axi search "token refresh" --in #eng --after 2026-05-01
  slack-axi search "contract" --files --from alice
  slack-axi search "budget" --with alice --type im`;

/** Hard ceiling on a single sweep, stated in output if hit (never a silent truncation). */
const SWEEP_CEILING = 1000;
/** Slack search pages are capped at 100 results each. */
const PAGE_SIZE = 100;

type ConvType = "public" | "private" | "mpim" | "im";
const CONV_TYPES: ConvType[] = ["public", "private", "mpim", "im"];

export async function searchCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return SEARCH_HELP;

  const team = takeFlag(args, "--team");
  const filesFlag = takeBool(team.rest, "--files");
  const files = filesFlag.present;
  const inFlag = takeFlag(filesFlag.rest, "--in");
  const fromFlag = takeFlag(inFlag.rest, "--from");
  const withFlag = takeFlag(fromFlag.rest, "--with");
  const toFlag = takeFlag(withFlag.rest, "--to");
  const hasFlags = takeFlags(toFlag.rest, "--has");
  const isFlags = takeFlags(hasFlags.rest, "--is");
  const after = takeFlag(isFlags.rest, "--after");
  const before = takeFlag(after.rest, "--before");
  const on = takeFlag(before.rest, "--on");
  const during = takeFlag(on.rest, "--during");
  const typeFlag = takeFlag(during.rest, "--type");
  const limitFlag = takeFlag(typeFlag.rest, "--limit");
  const citeFlag = takeBool(limitFlag.rest, "--cite");
  const cite = citeFlag.present;
  const positional = citeFlag.rest.filter((a) => !a.startsWith("-"));
  const query = positional.join(" ").trim();
  if (!query) {
    throw new AxiError('usage: slack-axi search "<query>" [flags]', "USAGE", [
      'Pass a search query, e.g. slack-axi search "proposal loss"',
    ]);
  }

  let type: ConvType | undefined;
  if (typeFlag.value) {
    if (!CONV_TYPES.includes(typeFlag.value as ConvType)) {
      throw new AxiError(`Unknown --type '${typeFlag.value}'`, "USAGE", [
        "Use one of: public, private, mpim, im",
      ]);
    }
    type = typeFlag.value as ConvType;
  }

  // `--limit` caps the sweep; absent means "all" (capped by the runaway ceiling).
  const limit = limitFlag.value ? Number.parseInt(limitFlag.value, 10) : undefined;
  const cap =
    Number.isFinite(limit) && (limit as number) > 0
      ? Math.min(limit as number, SWEEP_CEILING)
      : SWEEP_CEILING;

  const session = await activeSession({ teamFlag: team.value });
  const tz = DEFAULT_TZ;
  await ensureUsers(session); // needed for identity resolution + author labels; one cached call
  // `--type` classifies each match by its channel's true type, which the prefix alone can't give
  // (C covers both public and private). Prime the member-channel cache so getCachedChannel resolves.
  if (type && !files) await getChannels(session);

  // Translate friendly flags into Slack search modifiers.
  const notes: string[] = [];
  const parts = [query];
  if (inFlag.value) parts.push(`in:#${await channelNameFor(session, inFlag.value)}`);
  if (fromFlag.value) parts.push(`from:${userModifier(session, fromFlag.value, notes, "--from")}`);
  if (withFlag.value) parts.push(`with:${userModifier(session, withFlag.value, notes, "--with")}`);
  if (toFlag.value) parts.push(`to:${userModifier(session, toFlag.value, notes, "--to")}`);
  for (const h of hasFlags.values) parts.push(`has:${h}`);
  for (const i of isFlags.values) parts.push(`is:${i}`);
  if (after.value) parts.push(`after:${toSearchDate(after.value, tz)}`);
  if (before.value) parts.push(`before:${toSearchDate(before.value, tz)}`);
  if (on.value) parts.push(`on:${toSearchDate(on.value, tz)}`);
  if (during.value) parts.push(`during:${during.value}`);
  const fullQuery = parts.join(" ");

  const who = session.userName ? `@${session.userName}` : "you";
  const coverage = session.userId
    ? `${who} (${session.userId}) — only conversations you belong to`
    : "only conversations you belong to";
  const header: Record<string, unknown> = {
    workspace: `${session.teamName ?? session.teamId} (${session.teamId})`,
    query: fullQuery,
    coverage,
  };

  const users = allCachedUsers(session.teamId);
  const sweep: Sweep<unknown> = files
    ? await sweepFiles(session, fullQuery, cap)
    : await sweepMessages(session, fullQuery, cap);
  let rows = files
    ? (sweep.items as FileMatch[]).map((m) => fileRow(m, users, tz, cite))
    : (sweep.items as MessageMatch[]).map((m) => messageRow(m, users, tz, cite, session.teamId));

  // `--type` is a post-filter over retrieved matches (Slack search has no conversation-type modifier),
  // so we report it honestly as a filter, never as query narrowing. Files have no single channel.
  let typeFiltered: number | undefined;
  if (type && !files) {
    const before = rows.length;
    rows = rows.filter((r) => r.__type === type);
    typeFiltered = before - rows.length;
  }
  for (const r of rows) delete r.__type;

  if (rows.length === 0) {
    const empty = type
      ? `0 ${files ? "files" : "messages"} for "${fullQuery}" after --type ${type} filter`
      : `0 ${files ? "files" : "messages"} for "${fullQuery}"`;
    return joinBlocks(
      encodeObject(header),
      encodeObject({ [files ? "files" : "matches"]: empty }),
      renderHelp([
        ...notes,
        "Broaden the query, drop a filter, or use `slack-axi read <channel> --from --to` to sweep a window",
      ]),
    );
  }

  // `complete` reflects whether the underlying sweep retrieved every match Slack has for the query; a
  // `--type` post-filter narrows what's shown but doesn't change that fact.
  header.complete = sweep.complete;
  if (sweep.ceilingHit)
    header.note = `stopped at the ${SWEEP_CEILING}-match ceiling; narrow the query or window`;

  const label = files ? "files" : "matches";
  const help = [
    ...notes,
    typeFiltered !== undefined
      ? `--type ${type}: kept ${rows.length} of ${sweep.items.length} retrieved`
      : undefined,
    !files
      ? "To read a result's channel over a window, use `slack-axi read <channel> --from <date> --to <date>`"
      : undefined,
    !sweep.complete
      ? `Showing ${sweep.items.length} of ${sweep.total}; raise \`--limit <n>\` or narrow the query`
      : undefined,
    !cite
      ? "Add `--cite` (or run `slack-axi cite <channel> <ts>`) for permalinks to cite"
      : undefined,
  ].filter((l): l is string => Boolean(l));

  return joinBlocks(
    encodeObject(header),
    renderList(label, rows, { total: type && !files ? rows.length : sweep.total }),
    renderHelp(help),
  );
}

// ---------------------------------------------------------------------------- sweep (pagination)

interface Sweep<T> {
  items: T[];
  /** Slack's reported grand total for the query (what a complete sweep would yield). */
  total: number;
  /** True when every match Slack has for the query was retrieved. */
  complete: boolean;
  /** True when the runaway ceiling stopped the sweep before exhaustion. */
  ceilingHit: boolean;
}

type MessageMatch = {
  ts?: string;
  user?: string;
  username?: string;
  text?: string;
  permalink?: string;
  channel?: { id?: string; name?: string };
};

type FileMatch = {
  id?: string;
  title?: string;
  name?: string;
  filetype?: string;
  permalink?: string;
  timestamp?: number;
  user?: unknown;
  username?: string;
};

/**
 * Page-based sweep shared by messages and files: both endpoints expose `paging: {page, pages, total}`,
 * so we loop pages to completion (or to `cap`/the ceiling) rather than depend on a cursor field the
 * response type doesn't surface. Requests `sort: timestamp` so accumulation is oldest→newest stable.
 */
async function sweepMessages(
  session: Session,
  query: string,
  cap: number,
): Promise<Sweep<MessageMatch>> {
  return paginate(cap, async (page) => {
    let res;
    try {
      res = await session.client.search.messages({
        query,
        count: PAGE_SIZE,
        page,
        sort: "timestamp",
        sort_dir: "asc",
      });
    } catch (err) {
      throw scopeError(err, "search:read");
    }
    return {
      items: (res.messages?.matches ?? []) as MessageMatch[],
      pages: res.messages?.paging?.pages ?? 1,
      total: res.messages?.paging?.total ?? res.messages?.total ?? 0,
    };
  });
}

async function sweepFiles(session: Session, query: string, cap: number): Promise<Sweep<FileMatch>> {
  return paginate(cap, async (page) => {
    let res;
    try {
      res = await session.client.search.files({
        query,
        count: PAGE_SIZE,
        page,
        sort: "timestamp",
        sort_dir: "asc",
      });
    } catch (err) {
      // search.files (like search.messages) is covered by search:read — files:read is not required.
      throw scopeError(err, "search:read");
    }
    return {
      items: (res.files?.matches ?? []) as FileMatch[],
      pages: res.files?.paging?.pages ?? 1,
      total: res.files?.paging?.total ?? res.files?.total ?? 0,
    };
  });
}

/** Drive a page-based endpoint to completion, stopping at `cap` matches or the page count. Exported for tests. */
export async function paginate<T>(
  cap: number,
  fetchPage: (page: number) => Promise<{ items: T[]; pages: number; total: number }>,
): Promise<Sweep<T>> {
  const items: T[] = [];
  let total = 0;
  let pages = 1;
  let page = 1;
  do {
    const res = await fetchPage(page);
    pages = res.pages;
    total = res.total;
    items.push(...res.items);
    page++;
  } while (page <= pages && items.length < cap && items.length < SWEEP_CEILING);

  const capped = items.slice(0, cap);
  const complete = capped.length >= total;
  const ceilingHit = !complete && capped.length >= SWEEP_CEILING;
  return { items: capped, total, complete, ceilingHit };
}

// ---------------------------------------------------------------------------- rows

function messageRow(
  m: MessageMatch,
  users: Record<string, UserMeta>,
  tz: string,
  cite: boolean,
  teamId: string,
): Record<string, unknown> {
  const ts = String(m.ts ?? "");
  const row: Record<string, unknown> = {
    channel: formatMatchChannel(m.channel),
    author: m.username || (m.user ? userName(m.user, users) : "(unknown)"),
    when: m.ts ? formatDateTime(tsToEpochMs(ts), tz) : "",
    text: truncate(formatText(typeof m.text === "string" ? m.text : "", users)),
    ts: handle(ts),
    __type: convTypeOf(teamId, m.channel?.id),
  };
  if (cite && typeof m.permalink === "string") row.permalink = m.permalink;
  return row;
}

function fileRow(
  m: FileMatch,
  users: Record<string, UserMeta>,
  tz: string,
  cite: boolean,
): Record<string, unknown> {
  const author = typeof m.user === "string" ? userName(m.user, users) : m.username || "(unknown)";
  const row: Record<string, unknown> = {
    title: truncate(m.title || m.name || "(untitled)", 120),
    type: m.filetype || "",
    author,
    when: typeof m.timestamp === "number" ? formatDateTime(m.timestamp * 1000, tz) : "",
    id: m.id || "",
  };
  // A file's permalink is its detail page and is always useful for citation, so include it by default.
  if (typeof m.permalink === "string") row.permalink = m.permalink;
  // `cite` is honored for symmetry, but files have no message ts/channel to cite via the `cite` command.
  void cite;
  return row;
}

// ---------------------------------------------------------------------------- helpers

/** Resolve a `--in` channel argument to its bare name for the `in:#name` modifier. */
async function channelNameFor(session: Session, arg: string): Promise<string> {
  if (looksLikeId(arg)) {
    const ch = await resolveChannel(session, arg);
    return ch.name || arg;
  }
  return normalizeChannelArg(arg);
}

/**
 * Build the value for a `from:`/`with:`/`to:` modifier. An `@handle` or id passes through; a bare name
 * is resolved to an exact `<@U…>` (Slack's precise form). On no/ambiguous match we fall back to
 * `@name` and record a note so the agent knows the filter is fuzzy.
 */
function userModifier(session: Session, arg: string, notes: string[], flag: string): string {
  const raw = arg.trim();
  if (raw.startsWith("@") || looksLikeId(raw.replace(/^@/, ""))) return ensureAt(raw);
  const res = resolveUserId(session, raw);
  if (res.kind === "id") return `<@${res.id}>`;
  if (res.kind === "ambiguous") {
    notes.push(
      `${flag} "${raw}" matched ${res.ids.length} users; used a fuzzy name filter — pass an id to disambiguate`,
    );
  } else {
    notes.push(`${flag} "${raw}" didn't match a cached user; used a fuzzy name filter`);
  }
  return ensureAt(raw);
}

/** Ensure a user reference has a leading `@` for `from:`/`with:`/`to:` modifiers. */
function ensureAt(user: string): string {
  return user.startsWith("@") ? user : `@${user}`;
}

/** Label a match's channel: `#name (id)` for channels/group DMs, `dm (id)` for a 1:1 (D…) id. */
function formatMatchChannel(ch: { id?: string; name?: string } | undefined): string {
  if (!ch?.id) return ch?.name ? `#${ch.name}` : "?";
  if (ch.id.startsWith("D")) return `dm (${ch.id})`;
  return ch.name ? `#${ch.name} (${ch.id})` : ch.id;
}

/**
 * Classify a match's channel into a conversation type for `--type` post-filtering. Prefers the cached
 * channel's true `type` (the only way to tell a public C-channel from a private one); falls back to the
 * id prefix when the channel isn't cached (D → im, G → mpim).
 */
function convTypeOf(teamId: string, id: string | undefined): ConvType | undefined {
  if (!id) return undefined;
  const cached = getCachedChannel(teamId, id);
  if (cached) return cached.type;
  if (id.startsWith("D")) return "im";
  if (id.startsWith("G")) return "mpim";
  return undefined;
}

/** Slack `after:`/`before:`/`on:` take a YYYY-MM-DD date; accept a date passthrough or a relative span. Exported for tests. */
export function toSearchDate(when: string, tz: string): string {
  const span = parseSpanMs(when);
  if (span !== undefined) return formatDate(Date.now() - span, tz);
  const date = /^(\d{4}-\d{2}-\d{2})/.exec(when.trim());
  return date ? date[1] : when;
}

/** Map a missing-scope Slack error to the AXI SCOPE_MISSING remediation; rethrow anything else. */
function scopeError(err: unknown, scope: string): unknown {
  const code = (err as { data?: { error?: string } })?.data?.error;
  if (code === "missing_scope") {
    return new AxiError(`Token is missing the ${scope} scope`, "SCOPE_MISSING", [
      `Re-run \`slack-axi auth setup\`, add ${scope}, re-install the app, then \`auth login\``,
    ]);
  }
  return err;
}
