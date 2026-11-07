import { randomUUID } from "node:crypto";
import { AxiError } from "axi-sdk-js";
import {
  type Draft,
  getDraft,
  getStoredToken,
  listDrafts,
  removeDraft,
  writeDraft,
} from "../config.js";
import { takeFlag } from "../flags.js";
import { encodeObject, joinBlocks, renderHelp, renderList, truncate } from "../output.js";
import { activeSession, ensureIdentity, type Identity, type Session } from "../session.js";
import { allCachedUsers, ensureUsersByIds } from "../slack/cache.js";
import { toAxiError } from "../slack/errors.js";
import { formatText, userName } from "../slack/format.js";
import { getPermalink } from "../slack/permalink.js";
import { channelLabel, resolveChannel } from "../slack/resolve.js";
import { fetchMessage, type Msg } from "../slack/threads.js";
import { dottedTs, handle } from "../slack/ts.js";

export const REACT_HELP = `usage: slack-axi react <channel> <ts> <:emoji:>
Adds an emoji reaction to a message. Idempotent — re-reacting is a no-op.
examples:
  slack-axi react #eng 1717589640123456 :eyes:
  slack-axi react C0123ABCD 1717589640.123456 tada`;

export const DRAFT_HELP = `usage: slack-axi draft <channel> "<text>" [--reply <ts>]
       slack-axi draft send <draft-id>
       slack-axi draft list
       slack-axi draft discard <draft-id>
Prepares a message for approval — \`draft\` does NOT send. Review it, then \`draft send <id>\` posts it.
\`draft send\` is also how an \`edit\` or \`delete\` draft is applied (one approval step for every write).
examples:
  slack-axi draft #eng "Deploy is green ✅"
  slack-axi draft #eng --reply 1717589640123456 "confirmed"
  slack-axi draft send d_1a2b3c4d
  slack-axi draft list`;

export const EDIT_HELP = `usage: slack-axi edit <channel> <ts> "<new text>"
       slack-axi edit <sent-draft-id> "<new text>"
Prepares an edit of one of THIS TOKEN'S OWN messages (checked before the draft is written) — nothing
changes in Slack until \`draft send <id>\`. The draft shows old → new for review. Target a message by
channel + ts handle, or by the id of a draft this tool already sent.
examples:
  slack-axi edit #eng 1717589640123456 "Deploy is green ✅ (all regions)"
  slack-axi edit d_1a2b3c4d "corrected wording"
  slack-axi draft send d_9f8e7d6c`;

export const DELETE_HELP = `usage: slack-axi delete <channel> <ts>
       slack-axi delete <sent-draft-id>
Prepares deletion of one of THIS TOKEN'S OWN messages (checked before the draft is written) — nothing
is removed until \`draft send <id>\`. The draft echoes the text that would be removed.
examples:
  slack-axi delete #eng 1717589640123456
  slack-axi delete d_1a2b3c4d
  slack-axi draft send d_9f8e7d6c`;

export type DraftKind = "post" | "edit" | "delete";

/** A draft's kind; records written before kinds existed are posts. */
export function draftKind(draft: Pick<Draft, "kind">): DraftKind {
  return draft.kind ?? "post";
}

/**
 * Whether a message is the token's own: posted by the identity's user, or by its bot. The only rule
 * that licenses an edit/delete — there is no override. See specs/commands/write.md.
 */
export function isOwnMessage(msg: Pick<Msg, "user" | "botId">, identity: Identity): boolean {
  if (identity.userId && msg.user === identity.userId) return true;
  if (identity.botId && msg.botId === identity.botId) return true;
  return false;
}

/** First non-blank line of a text, for confirmations that show what landed. */
export function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((l) => l.trim().length > 0)
      ?.trim() ?? ""
  );
}

/** The `status` cell for `draft list`, kind-aware. */
export function draftStatus(draft: Pick<Draft, "kind" | "sent" | "reply_to">): string {
  const kind = draftKind(draft);
  if (draft.sent) return kind === "post" ? "sent" : `${kind} applied`;
  if (kind === "post") return draft.reply_to ? "reply (pending)" : "pending";
  return `${kind} (pending)`;
}

const DRAFT_ID_RE = /^d_[0-9a-f]{8}$/;

export async function reactCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return REACT_HELP;
  const team = takeFlag(args, "--team");
  const [channelArg, tsArg, emojiArg] = team.rest.filter((a) => !a.startsWith("-"));
  if (!channelArg || !tsArg || !emojiArg) {
    throw new AxiError("usage: slack-axi react <channel> <ts> <:emoji:>", "USAGE", []);
  }
  const name = emojiArg.replace(/:/g, "").trim();

  const session = await activeSession({ teamFlag: team.value, mutation: true });
  const channel = await resolveChannel(session, channelArg);
  const ts = dottedTs(tsArg);

  try {
    await session.client.reactions.add({ channel: channel.id, timestamp: ts, name });
  } catch (err) {
    const code = (err as { data?: { error?: string } })?.data?.error;
    if (code === "already_reacted") {
      return encodeObject({
        reaction: `:${name}: already on ${await channelLabel(session, channel)} message ${handle(ts)} (no-op)`,
      });
    }
    throw toAxiError(err, { team: session.teamId, channel: channelArg });
  }
  return encodeObject({
    reaction: `:${name}: added`,
    channel: `${await channelLabel(session, channel)} (${channel.id})`,
    ts: handle(ts),
  });
}

export async function draftCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return DRAFT_HELP;
  const sub = args[0];
  if (sub === "send") return draftSend(args.slice(1));
  if (sub === "list") return draftList();
  if (sub === "discard") return draftDiscard(args.slice(1));
  return draftCreate(args);
}

export async function editCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return EDIT_HELP;
  const usage =
    'usage: slack-axi edit <channel> <ts> "<new text>"  |  edit <sent-draft-id> "<new text>"';
  const { target, text } = await resolveTarget(args, usage, true);
  if (!text) throw new AxiError(usage, "USAGE", ["Pass the replacement text as the last argument"]);

  const draft: Draft = {
    id: newDraftId(),
    team: target.session.teamId,
    channel_id: target.channelId,
    channel: target.label,
    kind: "edit",
    target_ts: target.ts,
    previous_text: target.message.text,
    text,
    created_at: new Date().toISOString(),
  };
  writeDraft(draft);

  return joinBlocks(
    encodeObject({
      draft: draft.id,
      kind: "edit",
      workspace: workspaceLabel(target.session),
      channel: `${target.label} (${target.channelId})`,
      target: handle(target.ts),
      old: target.previousRendered,
      new: text,
    }),
    renderHelp([
      `Review it, then apply with \`slack-axi draft send ${draft.id}\` (or discard with \`draft discard ${draft.id}\`)`,
    ]),
  );
}

export async function deleteCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return DELETE_HELP;
  const usage = "usage: slack-axi delete <channel> <ts>  |  delete <sent-draft-id>";
  const { target } = await resolveTarget(args, usage, false);

  const draft: Draft = {
    id: newDraftId(),
    team: target.session.teamId,
    channel_id: target.channelId,
    channel: target.label,
    kind: "delete",
    target_ts: target.ts,
    previous_text: target.message.text,
    text: "",
    created_at: new Date().toISOString(),
  };
  writeDraft(draft);

  return joinBlocks(
    encodeObject({
      draft: draft.id,
      kind: "delete",
      workspace: workspaceLabel(target.session),
      channel: `${target.label} (${target.channelId})`,
      target: handle(target.ts),
      old: target.previousRendered,
    }),
    renderHelp([
      `Review it, then apply with \`slack-axi draft send ${draft.id}\` (or discard with \`draft discard ${draft.id}\`)`,
    ]),
  );
}

// ---------------------------------------------------------------------------- edit/delete target

interface Target {
  session: Session;
  channelId: string;
  label: string;
  ts: string;
  message: Msg;
  /** The target's current text with Slack markup resolved, for the old → new review. */
  previousRendered: string;
}

/**
 * Resolve the target of an edit/delete — `<channel> <ts>` or `<sent-draft-id>` — fetch the message,
 * and enforce the ownership rule. All validation happens before any draft is written; a usage error
 * costs no network call.
 */
async function resolveTarget(
  args: string[],
  usage: string,
  takesText: boolean,
): Promise<{ target: Target; text: string }> {
  const team = takeFlag(args, "--team");
  const positional = team.rest.filter((a) => !a.startsWith("-"));
  if (positional.length === 0) throw new AxiError(usage, "USAGE", []);

  let session: Session;
  let channelId: string;
  let ts: string;
  let textParts: string[];

  if (DRAFT_ID_RE.test(positional[0])) {
    const prior = getDraft(positional[0]);
    if (!prior) {
      throw new AxiError(`Draft ${positional[0]} not found`, "DRAFT_NOT_FOUND", [
        "Run `slack-axi draft list` to see drafts; or target the message by <channel> <ts>",
      ]);
    }
    if (!prior.sent) {
      throw new AxiError(
        `Draft ${positional[0]} has not been sent, so there is no message to target`,
        "DRAFT_NOT_SENT",
        [
          `Edit the pending draft by discarding it and creating a new one: \`slack-axi draft discard ${positional[0]}\``,
        ],
      );
    }
    textParts = positional.slice(1);
    if (takesText && textParts.length === 0) throw new AxiError(usage, "USAGE", []);
    session = await activeSession({ teamFlag: team.value ?? prior.team });
    channelId = prior.channel_id;
    ts = prior.sent.ts;
  } else {
    const [channelArg, tsArg, ...rest] = positional;
    if (!channelArg || !tsArg || (takesText && rest.length === 0)) {
      throw new AxiError(usage, "USAGE", []);
    }
    textParts = rest;
    session = await activeSession({ teamFlag: team.value });
    channelId = (await resolveChannel(session, channelArg)).id;
    ts = dottedTs(tsArg);
  }

  const channel = await resolveChannel(session, channelId);
  const label = await channelLabel(session, channel);

  let message: Msg | undefined;
  try {
    message = await fetchMessage(session, channelId, ts);
  } catch (err) {
    throw toAxiError(err, { team: session.teamId, channel: label });
  }
  if (!message) {
    throw new AxiError(`No message ${handle(ts)} in ${label}`, "MESSAGE_NOT_FOUND", [
      `Run \`slack-axi read ${channelId}\` to find the message and its ts`,
    ]);
  }

  const identity = await ensureIdentity(session);
  await ensureUsersByIds(session, message.user ? [message.user] : []);
  const users = allCachedUsers(session.teamId);
  if (!isOwnMessage(message, identity)) {
    const who = message.user
      ? `@${userName(message.user, users)}`
      : message.botId
        ? `bot ${message.botId}`
        : "the system";
    throw new AxiError(
      `Message ${handle(ts)} in ${label} was posted by ${who}, not by this token's identity`,
      "NOT_MESSAGE_AUTHOR",
      [
        "Only the author can edit or delete a message; there is no override",
        `Post a follow-up instead: \`slack-axi draft ${channelId} --reply ${handle(ts)} "..."\``,
      ],
    );
  }

  return {
    target: {
      session,
      channelId,
      label,
      ts,
      message,
      previousRendered: formatText(message.text, users),
    },
    text: textParts.join(" ").trim(),
  };
}

// ---------------------------------------------------------------------------- drafts

function newDraftId(): string {
  return `d_${randomUUID().slice(0, 8)}`;
}

function workspaceLabel(session: Session): string {
  return `${session.teamName ?? session.teamId} (${session.teamId})`;
}

async function draftCreate(args: string[]): Promise<string> {
  const team = takeFlag(args, "--team");
  const reply = takeFlag(team.rest, "--reply");
  const positional = reply.rest.filter((a) => !a.startsWith("-"));
  const channelArg = positional[0];
  const text = positional.slice(1).join(" ");
  if (!channelArg || !text) {
    throw new AxiError('usage: slack-axi draft <channel> "<text>" [--reply <ts>]', "USAGE", []);
  }

  // Creating a draft is local-only (no Slack write), but we resolve the channel to validate + label it.
  const session = await activeSession({ teamFlag: team.value });
  const channel = await resolveChannel(session, channelArg);
  const label = await channelLabel(session, channel);

  const draft: Draft = {
    id: newDraftId(),
    team: session.teamId,
    channel_id: channel.id,
    channel: label,
    ...(reply.value ? { reply_to: dottedTs(reply.value) } : {}),
    text,
    created_at: new Date().toISOString(),
  };
  writeDraft(draft);

  return joinBlocks(
    encodeObject({
      draft: draft.id,
      workspace: workspaceLabel(session),
      channel: `${label} (${channel.id})`,
      ...(draft.reply_to ? { reply_to: handle(draft.reply_to) } : {}),
      text: draft.text,
    }),
    renderHelp([
      `Review it, then post with \`slack-axi draft send ${draft.id}\` (or discard with \`draft discard ${draft.id}\`)`,
    ]),
  );
}

async function draftSend(args: string[]): Promise<string> {
  const id = args.find((a) => !a.startsWith("-"));
  if (!id) throw new AxiError("usage: slack-axi draft send <draft-id>", "USAGE", []);
  const draft = getDraft(id);
  if (!draft) {
    throw new AxiError(`Draft ${id} not found`, "DRAFT_NOT_FOUND", [
      "Run `slack-axi draft list` to see pending drafts",
    ]);
  }
  const kind = draftKind(draft);
  if (draft.sent) {
    return encodeObject({
      [kind === "post" ? "sent" : "applied"]:
        `${id} already ${kind === "post" ? "sent" : "applied"} (no-op)`,
      kind,
      ts: handle(draft.sent.ts),
      ...(draft.sent.permalink ? { permalink: draft.sent.permalink } : {}),
    });
  }
  if (!getStoredToken(draft.team) && !process.env.SLACK_AXI_TOKEN) {
    throw new AxiError(
      `Draft's workspace ${draft.team} is no longer authenticated`,
      "TEAM_NOT_FOUND",
      ["Re-auth with `slack-axi auth login`, or discard the draft"],
    );
  }

  // Act on the draft's own workspace (explicit team satisfies write-protection).
  const session = await activeSession({ teamFlag: draft.team, mutation: true });
  const channel = `${draft.channel} (${draft.channel_id})`;

  if (kind === "edit") {
    const ts = draft.target_ts ?? "";
    try {
      await session.client.chat.update({ channel: draft.channel_id, ts, text: draft.text });
    } catch (err) {
      throw toAxiError(err, { team: draft.team, channel: draft.channel });
    }
    const permalink = await getPermalink(session, draft.channel_id, ts);
    draft.sent = { ts, permalink, at: new Date().toISOString() };
    writeDraft(draft);
    return encodeObject({
      applied: id,
      kind,
      channel,
      ts: handle(ts),
      permalink,
      text: firstLine(draft.text),
    });
  }

  if (kind === "delete") {
    const ts = draft.target_ts ?? "";
    let alreadyGone = false;
    try {
      await session.client.chat.delete({ channel: draft.channel_id, ts });
    } catch (err) {
      const code = (err as { data?: { error?: string } })?.data?.error;
      if (code === "message_not_found") alreadyGone = true;
      else throw toAxiError(err, { team: draft.team, channel: draft.channel });
    }
    draft.sent = { ts, permalink: "", at: new Date().toISOString() };
    writeDraft(draft);
    return encodeObject({
      applied: id,
      kind,
      channel,
      ts: handle(ts),
      deleted: alreadyGone ? "already gone (no-op)" : true,
    });
  }

  let posted;
  try {
    posted = await session.client.chat.postMessage({
      channel: draft.channel_id,
      text: draft.text,
      ...(draft.reply_to ? { thread_ts: draft.reply_to } : {}),
    });
  } catch (err) {
    throw toAxiError(err, { team: draft.team, channel: draft.channel });
  }

  const ts = String(posted.ts ?? "");
  const permalink = ts ? await getPermalink(session, draft.channel_id, ts) : "";
  draft.sent = { ts, permalink, at: new Date().toISOString() };
  writeDraft(draft);

  return encodeObject({ sent: id, channel, ts: handle(ts), permalink });
}

function draftList(): string {
  const drafts = listDrafts();
  if (drafts.length === 0) {
    return joinBlocks(
      encodeObject({ drafts: "0 drafts" }),
      renderHelp(['Create one with `slack-axi draft <channel> "<text>"`']),
    );
  }
  const rows = drafts.map((d) => ({
    id: d.id,
    channel: d.channel,
    status: draftStatus(d),
    text: truncate(draftKind(d) === "delete" ? (d.previous_text ?? "") : d.text, 80),
  }));
  return joinBlocks(
    renderList("drafts", rows),
    renderHelp(["Apply a pending draft with `slack-axi draft send <id>`"]),
  );
}

function draftDiscard(args: string[]): string {
  const id = args.find((a) => !a.startsWith("-"));
  if (!id) throw new AxiError("usage: slack-axi draft discard <draft-id>", "USAGE", []);
  const existed = removeDraft(id);
  return encodeObject({ discarded: existed ? id : `${id} (not found — no-op)` });
}
