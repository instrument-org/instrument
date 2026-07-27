import type { ModelMessage } from "ai";

import { describe, expect, it } from "vitest";

import {
  sanitizeModelText,
  sanitizeSurrogates,
  truncateWithoutSplitting,
} from "./sanitize-model-text";

const HIGH = "\uD83D";
const LOW = "\uDE08";

/** True when every character has a UTF-8 encoding, which is what a send needs. */
function encodable(text: string) {
  return Buffer.from(text, "utf8").toString("utf8") === text;
}

describe("sanitizeSurrogates", () => {
  it.each([
    { input: "plain text", name: "ascii" },
    { input: "Hello 🙈 World", name: "a paired emoji" },
    { input: "日本語とemoji 😀", name: "CJK and emoji" },
  ])("leaves $name untouched", ({ input }) => {
    expect(sanitizeSurrogates(input)).toBe(input);
  });

  it.each([
    { input: `before ${HIGH} after`, name: "a lone high surrogate" },
    { input: `before ${LOW} after`, name: "a lone low surrogate" },
    { input: `${HIGH}${LOW}${HIGH}`, name: "a pair followed by a half" },
  ])("removes $name", ({ input }) => {
    // Encodability is the whole test: a survivor with no UTF-8 form is what
    // gets the request rejected. Checking for the code unit itself would be
    // wrong, since a legitimately paired character contains one.
    expect(encodable(sanitizeSurrogates(input))).toBe(true);
  });

  it("keeps the pair and drops only the orphan", () => {
    expect(sanitizeSurrogates(`a${HIGH}${LOW}b${HIGH}c`)).toBe(
      `a${HIGH}${LOW}bc`,
    );
  });
});

describe("truncateWithoutSplitting", () => {
  it("returns short input unchanged", () => {
    expect(truncateWithoutSplitting("short", 100)).toBe("short");
  });

  it("cuts at the limit when no character straddles it", () => {
    expect(truncateWithoutSplitting("abcdef", 3)).toBe("abc");
  });

  it("drops a character rather than leaving half of one", () => {
    // The emoji's high surrogate sits at index 3, its low half at index 4.
    const text = `abc🙈def`;
    const result = truncateWithoutSplitting(text, 4);

    expect(result).toBe("abc");
    expect(encodable(result)).toBe(true);
  });

  it("keeps a character that ends exactly on the limit", () => {
    expect(truncateWithoutSplitting(`abc🙈def`, 5)).toBe("abc🙈");
  });
});

describe("sanitizeModelText", () => {
  it("cleans text parts across every role", () => {
    const messages: ModelMessage[] = [
      { content: `system ${HIGH} prompt`, role: "system" },
      {
        content: [
          { text: `user ${HIGH} text`, type: "text" },
          { data: "abc", mediaType: "image/png", type: "file" },
        ],
        role: "user",
      },
      {
        content: [{ text: `assistant ${LOW} text`, type: "text" }],
        role: "assistant",
      },
    ];

    const result = sanitizeModelText(messages);

    expect(JSON.stringify(result)).not.toMatch(/[\uD800-\uDFFF]/);
    expect(result[0]).toEqual({ content: "system  prompt", role: "system" });
    expect(result[1]?.content).toEqual([
      { text: "user  text", type: "text" },
      { data: "abc", mediaType: "image/png", type: "file" },
    ]);
  });

  it("cleans the text a tool returned, in both output shapes", () => {
    // Where file contents and command output reach the model, so the largest
    // source of text nobody on our side wrote.
    const messages: ModelMessage[] = [
      {
        content: [
          {
            output: { type: "text", value: `file ${HIGH} contents` },
            toolCallId: "call-1",
            toolName: "read_file",
            type: "tool-result",
          },
          {
            output: { type: "error-text", value: `stderr ${LOW}` },
            toolCallId: "call-2",
            toolName: "bash",
            type: "tool-result",
          },
          {
            output: {
              type: "content",
              value: [
                { text: `caption ${HIGH}`, type: "text" },
                { data: "abc", mediaType: "image/png", type: "media" },
              ],
            },
            toolCallId: "call-3",
            toolName: "read_file",
            type: "tool-result",
          },
        ],
        role: "tool",
      },
    ];

    const result = sanitizeModelText(messages);

    expect(JSON.stringify(result)).not.toMatch(/[\uD800-\uDFFF]/);
    expect(result[0]?.content).toEqual([
      {
        output: { type: "text", value: "file  contents" },
        toolCallId: "call-1",
        toolName: "read_file",
        type: "tool-result",
      },
      {
        output: { type: "error-text", value: "stderr " },
        toolCallId: "call-2",
        toolName: "bash",
        type: "tool-result",
      },
      {
        output: {
          type: "content",
          value: [
            { text: "caption ", type: "text" },
            { data: "abc", mediaType: "image/png", type: "media" },
          ],
        },
        toolCallId: "call-3",
        toolName: "read_file",
        type: "tool-result",
      },
    ]);
  });

  it("cleans a provider-executed tool result on an assistant message", () => {
    const messages: ModelMessage[] = [
      {
        content: [
          {
            output: { type: "text", value: `result ${HIGH}` },
            toolCallId: "call-4",
            toolName: "web_search",
            type: "tool-result",
          },
        ],
        role: "assistant",
      },
    ];

    expect(encodable(JSON.stringify(sanitizeModelText(messages)))).toBe(true);
    expect(JSON.stringify(sanitizeModelText(messages))).not.toMatch(
      /[\uD800-\uDFFF]/,
    );
  });

  it("leaves clean messages alone", () => {
    const messages: ModelMessage[] = [
      { content: "nothing wrong here 🙈", role: "system" },
      { content: [{ text: "also fine", type: "text" }], role: "user" },
      {
        content: [
          {
            output: { type: "text", value: "fine too 🙈" },
            toolCallId: "call-1",
            toolName: "read_file",
            type: "tool-result",
          },
        ],
        role: "tool",
      },
    ];

    expect(sanitizeModelText(messages)).toEqual(messages);
  });
});
