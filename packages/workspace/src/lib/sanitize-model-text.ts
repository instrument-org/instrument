import type { ModelMessage } from "ai";

// A surrogate that lost its partner: a high surrogate with no low one after it,
// or a low surrogate with no high one before it.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Strip unpaired surrogates from every outgoing text part.
 *
 * Sits beside the image pass and for the same reason: whatever a provider
 * refuses is already saved and replayed on every later turn, so the last point
 * before sending is the only place that covers every source at once instead of
 * each one separately.
 */
export function sanitizeModelText(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role === "system") {
      return { ...message, content: sanitizeSurrogates(message.content) };
    }
    if (message.role === "tool") {
      return message;
    }
    if (typeof message.content === "string") {
      return { ...message, content: sanitizeSurrogates(message.content) };
    }
    if (message.role === "user") {
      return {
        ...message,
        content: message.content.map((part) =>
          part.type === "text"
            ? { ...part, text: sanitizeSurrogates(part.text) }
            : part,
        ),
      };
    }
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "text"
          ? { ...part, text: sanitizeSurrogates(part.text) }
          : part,
      ),
    };
  });
}

/**
 * Drop unpaired surrogates from a string.
 *
 * A character outside the Basic Multilingual Plane -- every emoji, most CJK
 * extensions -- is stored as two UTF-16 code units. Cut a string between them
 * and the half left behind is not a character at all: it has no UTF-8 encoding,
 * and a provider handed one rejects the request.
 *
 * Properly paired characters are untouched; only halves are removed.
 */
export function sanitizeSurrogates(text: string) {
  return text.replaceAll(LONE_SURROGATE, "");
}

/**
 * Truncate to a length in UTF-16 code units without splitting a character.
 *
 * Slicing at a fixed index is how a lone surrogate gets made in the first
 * place, and the result poisons every later turn, since truncated text is
 * written to disk and replayed.
 */
export function truncateWithoutSplitting(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }
  const cut = text.slice(0, Math.max(0, maxLength));
  // Reading the last position gives the high surrogate only when its partner
  // was cut away; a character that survived whole ends on its low half, which
  // is outside this range.
  const last = cut.codePointAt(cut.length - 1);
  const endsMidCharacter =
    last !== undefined && last >= 0xd8_00 && last <= 0xdb_ff;
  return endsMidCharacter ? cut.slice(0, -1) : cut;
}
