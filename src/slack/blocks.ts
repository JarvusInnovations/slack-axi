import { markdownToBlocks } from "@jarvus/mack";
import type { KnownBlock } from "@slack/web-api";
import { protectSlackTokens, restoreSlackTokens } from "./mrkdwn.js";

/**
 * Outgoing rendering, bot mode: Markdown → Block Kit, chunked the way claude-assist posts
 * (`packages/chat/src/index.ts` → chunkBlocks/postResponse). See specs/behaviors/mrkdwn.md.
 */

/** Slack's per-message block limit. */
export const MAX_BLOCKS_PER_MESSAGE = 50;
/** The `text` fallback on the first chunk is the Markdown source, capped here. */
export const FALLBACK_TEXT_MAX = 3000;

export interface BlocksRendering {
  /** Block chunks, each postable as one message. */
  chunks: KnownBlock[][];
  /** `text` fallback for the first chunk (notifications/search); later chunks use `(continued)`. */
  fallbackText: string;
}

/**
 * Split blocks into message-sized chunks: at most 50 blocks each, at most one `table` block each, and a
 * flush right after a table so the next table starts its own message.
 */
export function chunkBlocks(blocks: KnownBlock[]): KnownBlock[][] {
  const chunks: KnownBlock[][] = [];
  let current: KnownBlock[] = [];
  for (const block of blocks) {
    const isTable = (block as { type: string }).type === "table";
    const currentHasTable = current.some((b) => (b as { type: string }).type === "table");
    if (current.length >= MAX_BLOCKS_PER_MESSAGE || (isTable && currentHasTable)) {
      if (current.length > 0) chunks.push(current);
      current = [];
    }
    current.push(block);
    if (isTable) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Render Markdown to chunked Block Kit, protecting Slack-native tokens through the parser. */
export async function renderBlocks(markdown: string): Promise<BlocksRendering> {
  const { text, tokens } = protectSlackTokens(markdown);
  const blocks = await markdownToBlocks(text);
  const restored = JSON.parse(
    restoreSlackTokens(
      JSON.stringify(blocks),
      tokens.map((t) => JSON.stringify(t).slice(1, -1)),
    ),
  ) as KnownBlock[];
  return { chunks: chunkBlocks(restored), fallbackText: fallbackTextFor(markdown) };
}

/** First 3000 chars of the source, for the first chunk's `text`. */
export function fallbackTextFor(markdown: string): string {
  return markdown.slice(0, FALLBACK_TEXT_MAX);
}

/** The text content of a chunk's blocks, joined — the plain-text fallback when Slack rejects blocks. */
export function blocksText(chunk: KnownBlock[]): string {
  return chunk
    .map((b) => {
      const text = (b as { text?: { text?: string } }).text;
      return typeof text?.text === "string" ? text.text : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/** `blocks: 7 in 2 chunk(s)` plus each chunk's block types, for the draft echo and --preview. */
export function summarizeBlocks(chunks: KnownBlock[][]): Record<string, unknown> {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  return {
    blocks: `${total} in ${chunks.length} chunk(s)`,
    chunks: chunks.map(
      (c, i) => `${i + 1}: ${c.map((b) => (b as { type: string }).type).join(", ")}`,
    ),
  };
}
