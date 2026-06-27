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
import { activeSession } from "../session.js";
import { getPermalink } from "../slack/permalink.js";
import { channelLabel, resolveChannel } from "../slack/resolve.js";
import { toAxiError } from "../slack/errors.js";
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
examples:
  slack-axi draft #eng "Deploy is green ✅"
  slack-axi draft #eng --reply 1717589640123456 "confirmed"
  slack-axi draft send d_1a2b3c4d
  slack-axi draft list`;

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
    id: `d_${randomUUID().slice(0, 8)}`,
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
      workspace: `${session.teamName ?? session.teamId} (${session.teamId})`,
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
  if (draft.sent) {
    return encodeObject({
      sent: `${id} already sent (no-op)`,
      ts: handle(draft.sent.ts),
      permalink: draft.sent.permalink,
    });
  }
  if (!getStoredToken(draft.team)) {
    throw new AxiError(
      `Draft's workspace ${draft.team} is no longer authenticated`,
      "TEAM_NOT_FOUND",
      ["Re-auth with `slack-axi auth login`, or discard the draft"],
    );
  }

  // Send to the draft's own workspace (explicit team satisfies write-protection).
  const session = await activeSession({ teamFlag: draft.team, mutation: true });
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

  return encodeObject({
    sent: id,
    channel: `${draft.channel} (${draft.channel_id})`,
    ts: handle(ts),
    permalink,
  });
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
    status: d.sent ? "sent" : d.reply_to ? "reply (pending)" : "pending",
    text: truncate(d.text, 80),
  }));
  return joinBlocks(
    renderList("drafts", rows),
    renderHelp(["Post a pending draft with `slack-axi draft send <id>`"]),
  );
}

function draftDiscard(args: string[]): string {
  const id = args.find((a) => !a.startsWith("-"));
  if (!id) throw new AxiError("usage: slack-axi draft discard <draft-id>", "USAGE", []);
  const existed = removeDraft(id);
  return encodeObject({ discarded: existed ? id : `${id} (not found — no-op)` });
}
