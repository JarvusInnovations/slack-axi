import { slackifyMarkdown } from "slackify-markdown";

/**
 * Outgoing rendering, human mode: Markdown → Slack mrkdwn text. The writer writes Markdown; this
 * module owns the dialect. Slack-native tokens already in the text (mentions, channel refs, specials,
 * `<url|label>` links) are protected through the conversion so hand-written mrkdwn survives.
 * See specs/behaviors/mrkdwn.md.
 */

/** Slack markup that Markdown renderers would escape or re-link: swap out, render, swap back. */
const SLACK_TOKEN_RE =
  /<(?:@U[A-Z0-9]+(?:\|[^>]*)?|#C[A-Z0-9]+\|[^>]*|![a-z^][^>]*|https?:\/\/[^>]+)>/g;

const PLACEHOLDER_OPEN = "";
const PLACEHOLDER_CLOSE = "";
const PLACEHOLDER_RE = /(\d+)/g;

/** Replace Slack-native tokens with placeholders a Markdown parser passes through untouched. */
export function protectSlackTokens(text: string): { text: string; tokens: string[] } {
  const tokens: string[] = [];
  const protectedText = text.replace(SLACK_TOKEN_RE, (m) => {
    tokens.push(m);
    return `${PLACEHOLDER_OPEN}${tokens.length - 1}${PLACEHOLDER_CLOSE}`;
  });
  return { text: protectedText, tokens };
}

/** Put the protected tokens back. */
export function restoreSlackTokens(text: string, tokens: string[]): string {
  return text.replace(PLACEHOLDER_RE, (_m, i) => tokens[Number(i)] ?? "");
}

/**
 * Render Markdown to mrkdwn text. Pure. Trailing newline from the stringifier is trimmed; interior
 * structure (paragraph breaks, list nesting, code fences) is preserved.
 */
export function renderMrkdwn(markdown: string): string {
  const { text, tokens } = protectSlackTokens(markdown);
  const rendered = slackifyMarkdown(text);
  return restoreSlackTokens(rendered, tokens).replace(/\n+$/, "");
}
