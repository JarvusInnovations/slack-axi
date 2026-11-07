import { randomUUID } from "node:crypto";
import type { KnownBlock } from "@slack/web-api";
import { AxiError } from "axi-sdk-js";
import {
  type Draft,
  getDraft,
  getStoredToken,
  listDrafts,
  type Mode,
  removeDraft,
  writeDraft,
} from "../config.js";
import { takeBool, takeFlag } from "../flags.js";
import { encodeObject, joinBlocks, renderHelp, renderList, truncate } from "../output.js";
import {
  activeSession,
  ensureIdentity,
  type Identity,
  resolveMode,
  type Session,
} from "../session.js";
import { blocksText, renderBlocks, summarizeBlocks } from "../slack/blocks.js";
import { allCachedUsers, ensureUsersByIds } from "../slack/cache.js";
import { toAxiError } from "../slack/errors.js";
import { formatText, userName } from "../slack/format.js";
import { renderMrkdwn } from "../slack/mrkdwn.js";
import { getPermalink } from "../slack/permalink.js";
import { channelLabel, resolveChannel } from "../slack/resolve.js";
import { fetchMessage, type Msg } from "../slack/threads.js";
import { dottedTs, handle } from "../slack/ts.js";

export const REACT_HELP = `usage: slack-axi react <channel> <ts> <:emoji:>
Adds an emoji reaction to a message. Idempotent — re-reacting is a no-op.
examples:
  slack-axi react #eng 1717589640123456 :eyes:
  slack-axi react C0123ABCD 1717589640.123456 tada`;

export const DRAFT_HELP = `usage: slack-axi draft <channel> "<markdown>" [--reply <ts>] [--raw] [--preview]
       slack-axi draft send <draft-id>
       slack-axi draft list
       slack-axi draft discard <draft-id>
Prepares a message for approval — \`draft\` does NOT send. Review it, then \`draft send <id>\` posts it.
Write MARKDOWN: it is rendered to Slack's dialect for the workspace mode (human → mrkdwn text,
bot → Block Kit; see \`auth mode\`). Hand-written mrkdwn tokens (<@U…>, <url|label>, • bullets) pass
through untouched; \`*x*\` means italic — write \`**x**\` for bold.
\`draft send\` is also how an \`edit\` or \`delete\` draft is applied (one approval step for every write).
flags[3]:
  --reply <ts>   Post as a thread reply
  --raw          Skip rendering; send the text verbatim (for callers that already write mrkdwn)
  --preview      Print the rendering and write nothing
examples:
  slack-axi draft #eng "Deploy is **green** ✅ — see [runbook](https://r.un/book)"
  slack-axi draft #eng --reply 1717589640123456 "confirmed"
  slack-axi draft #eng --preview "## Status\\n- api ok\\n- web ok"
  slack-axi draft send d_1a2b3c4d`;

export const EDIT_HELP = `usage: slack-axi edit <channel> <ts> "<new markdown>" [--raw] [--preview]
       slack-axi edit <sent-draft-id> "<new markdown>"
Prepares an edit of one of THIS TOKEN'S OWN messages (checked before the draft is written) — nothing
changes in Slack until \`draft send <id>\`. The draft shows old → new for review. Target a message by
channel + ts handle, or by the id of a draft this tool already sent. The new text is Markdown and is
rendered exactly as \`draft\` renders it (\`--raw\` to skip, \`--preview\` to see it without saving).
examples:
  slack-axi edit #eng 1717589640123456 "Deploy is **green** ✅ (all regions)"
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

// ---------------------------------------------------------------------------- outgoing rendering

/** What a draft will send: `text` always; `blocks` (one chunk per message) in bot mode. */
export interface Outgoing {
  text: string;
  blocks?: KnownBlock[][];
}

/**
 * Render Markdown for the mode — mrkdwn text (human), chunked Block Kit with a text fallback (bot) —
 * or pass it through verbatim with `raw`. Pure given the mode. See specs/behaviors/mrkdwn.md.
 */
export async function renderOutgoing(
  mode: Mode,
  markdown: string,
  raw: boolean,
): Promise<Outgoing> {
  if (raw) return { text: markdown };
  if (mode === "bot") {
    const r = await renderBlocks(markdown);
    return { text: r.fallbackText, blocks: r.chunks };
  }
  return { text: renderMrkdwn(markdown) };
}

/** The fields that show a reviewer what will be sent (draft echo + --preview). */
export function describeOutgoing(mode: Mode, out: Outgoing, raw: boolean): Record<string, unknown> {
  if (raw) return { mode, raw: true, text: out.text };
  if (out.blocks) {
    return { mode, ...summarizeBlocks(out.blocks), text_fallback: truncate(out.text, 200) };
  }
  return { mode, text: out.text };
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
  const raw = takeBool(args, "--raw");
  const preview = takeBool(raw.rest, "--preview");
  const { target, text: markdown } = await resolveTarget(preview.rest, usage, true);
  if (!markdown) {
    throw new AxiError(usage, "USAGE", ["Pass the replacement text as the last argument"]);
  }

  const mode = await resolveMode(target.session);
  const out = await renderOutgoing(mode, markdown, raw.present);
  if (out.blocks && out.blocks.length > 1) {
    throw new AxiError(
      `The new text renders to ${out.blocks.length} messages' worth of blocks; an edit can replace only one`,
      "TOO_LONG_FOR_EDIT",
      [
        'Shorten the text, or post the rest as a thread reply with `slack-axi draft <channel> --reply <ts> "..."`',
      ],
    );
  }
  const shown = describeOutgoing(mode, out, raw.present);

  if (preview.present) {
    return encodeObject({
      preview: "nothing saved",
      kind: "edit",
      channel: `${target.label} (${target.channelId})`,
      target: handle(target.ts),
      old: target.previousRendered,
      ...renameText(shown, "new"),
    });
  }

  const draft: Draft = {
    id: newDraftId(),
    team: target.session.teamId,
    channel_id: target.channelId,
    channel: target.label,
    kind: "edit",
    target_ts: target.ts,
    previous_text: target.message.text,
    markdown,
    text: out.text,
    ...(out.blocks ? { blocks: out.blocks } : {}),
    ...(raw.present ? { raw: true } : {}),
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
      ...renameText(shown, "new"),
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
    ...(target.chunks ? { target_chunks: target.chunks } : {}),
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
      ...(target.chunks ? { also_removes: target.chunks.slice(1).map(handle).join(", ") } : {}),
      old: target.previousRendered,
    }),
    renderHelp([
      `Review it, then apply with \`slack-axi draft send ${draft.id}\` (or discard with \`draft discard ${draft.id}\`)`,
    ]),
  );
}

/** In an edit echo the rendering is the `new` text, not `text`. */
function renameText(shown: Record<string, unknown>, to: string): Record<string, unknown> {
  if (!("text" in shown)) return shown;
  const { text, ...rest } = shown;
  return { ...rest, [to]: text };
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
  /** For a multi-chunk post targeted by draft id: every chunk ts (delete removes them all). */
  chunks?: string[];
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
  let chunks: string[] | undefined;

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
    const chunkCount = prior.sent.chunks?.length ?? 1;
    if (takesText && chunkCount > 1) {
      throw new AxiError(
        `Draft ${positional[0]} was posted as ${chunkCount} messages; an edit can replace only one`,
        "MULTI_CHUNK_POST",
        [
          `Delete and re-post: \`slack-axi delete ${positional[0]}\`, then a new \`draft\``,
          "Or edit one message by <channel> <ts> (see all_ts in the send confirmation)",
        ],
      );
    }
    chunks = chunkCount > 1 ? prior.sent.chunks : undefined;
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
      ...(chunks ? { chunks } : {}),
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
  const raw = takeBool(reply.rest, "--raw");
  const preview = takeBool(raw.rest, "--preview");
  const positional = preview.rest.filter((a) => !a.startsWith("-"));
  const channelArg = positional[0];
  const markdown = positional.slice(1).join(" ");
  if (!channelArg || !markdown) {
    throw new AxiError(
      'usage: slack-axi draft <channel> "<markdown>" [--reply <ts>] [--raw] [--preview]',
      "USAGE",
      [],
    );
  }

  // Creating a draft is local-only (no Slack write), but we resolve the channel to validate + label it.
  const session = await activeSession({ teamFlag: team.value });
  const channel = await resolveChannel(session, channelArg);
  const label = await channelLabel(session, channel);
  const mode = await resolveMode(session);
  const out = await renderOutgoing(mode, markdown, raw.present);
  const shown = describeOutgoing(mode, out, raw.present);

  if (preview.present) {
    return encodeObject({
      preview: "nothing saved",
      channel: `${label} (${channel.id})`,
      ...(reply.value ? { reply_to: handle(dottedTs(reply.value)) } : {}),
      ...shown,
    });
  }

  const draft: Draft = {
    id: newDraftId(),
    team: session.teamId,
    channel_id: channel.id,
    channel: label,
    ...(reply.value ? { reply_to: dottedTs(reply.value) } : {}),
    markdown,
    text: out.text,
    ...(out.blocks ? { blocks: out.blocks } : {}),
    ...(raw.present ? { raw: true } : {}),
    created_at: new Date().toISOString(),
  };
  writeDraft(draft);

  return joinBlocks(
    encodeObject({
      draft: draft.id,
      workspace: workspaceLabel(session),
      channel: `${label} (${channel.id})`,
      ...(draft.reply_to ? { reply_to: handle(draft.reply_to) } : {}),
      ...shown,
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
  const blocks = draft.blocks as KnownBlock[][] | undefined;

  if (kind === "edit") {
    const ts = draft.target_ts ?? "";
    try {
      // Blocks are replaced wholesale: the rendering's single chunk, or none (clears any prior blocks).
      await session.client.chat.update({
        channel: draft.channel_id,
        ts,
        text: draft.text,
        blocks: blocks?.[0] ?? [],
      });
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
      text: firstLine(draft.markdown ?? draft.text),
    });
  }

  if (kind === "delete") {
    const ts = draft.target_ts ?? "";
    // A multi-chunk post targeted by draft id removes every chunk; a missing one is already gone.
    const targets =
      draft.target_chunks && draft.target_chunks.length > 0 ? draft.target_chunks : [ts];
    let gone = 0;
    for (const t of targets) {
      try {
        await session.client.chat.delete({ channel: draft.channel_id, ts: t });
      } catch (err) {
        const code = (err as { data?: { error?: string } })?.data?.error;
        if (code === "message_not_found") gone++;
        else throw toAxiError(err, { team: draft.team, channel: draft.channel });
      }
    }
    draft.sent = { ts, permalink: "", at: new Date().toISOString() };
    writeDraft(draft);
    return encodeObject({
      applied: id,
      kind,
      channel,
      ts: handle(ts),
      deleted:
        gone === targets.length
          ? "already gone (no-op)"
          : targets.length > 1
            ? ` message(s)`
            : true,
    });
  }

  // Post: one message, or one per block chunk in bot mode (first carries the text fallback).
  const chunks: Array<KnownBlock[] | undefined> =
    blocks && blocks.length > 0 ? blocks : [undefined];
  const posted: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const base = {
      channel: draft.channel_id,
      ...(draft.reply_to ? { thread_ts: draft.reply_to } : {}),
    };
    try {
      const res = chunk
        ? await session.client.chat.postMessage({
            ...base,
            blocks: chunk,
            text: i === 0 ? draft.text : "(continued)",
          })
        : await session.client.chat.postMessage({ ...base, text: draft.text });
      posted.push(String(res.ts ?? ""));
    } catch (err) {
      const code = (err as { data?: { error?: string } })?.data?.error;
      if (chunk && code === "invalid_blocks") {
        // Slack rejected the blocks: fall back to the blocks' text for this chunk, as claude-assist does.
        const res = await session.client.chat
          .postMessage({ ...base, text: blocksText(chunk) || draft.text })
          .catch((e) => {
            throw toAxiError(e, { team: draft.team, channel: draft.channel });
          });
        posted.push(String(res.ts ?? ""));
      } else {
        throw toAxiError(err, { team: draft.team, channel: draft.channel });
      }
    }
  }

  const ts = posted[0] ?? "";
  const permalink = ts ? await getPermalink(session, draft.channel_id, ts) : "";
  draft.sent = {
    ts,
    permalink,
    at: new Date().toISOString(),
    ...(posted.length > 1 ? { chunks: posted } : {}),
  };
  writeDraft(draft);

  return encodeObject({
    sent: id,
    channel,
    ts: handle(ts),
    permalink,
    ...(posted.length > 1
      ? { messages: posted.length, all_ts: posted.map((t) => handle(t)).join(", ") }
      : {}),
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
    status: draftStatus(d),
    text: truncate(
      draftKind(d) === "delete" ? (d.previous_text ?? "") : (d.markdown ?? d.text),
      80,
    ),
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
