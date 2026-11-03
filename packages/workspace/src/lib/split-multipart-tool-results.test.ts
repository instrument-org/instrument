import type { ModelMessage, ToolResultPart } from "ai";

import { describe, expect, it } from "vitest";

import { splitMultipartToolResults } from "./split-multipart-tool-results";

const toolResult = (
  toolCallId: string,
  output: ToolResultPart["output"],
): ToolResultPart => ({
  output,
  toolCallId,
  toolName: "read_file",
  type: "tool-result",
});

const imageResult: ModelMessage = {
  content: [
    toolResult("call_1", {
      type: "content",
      value: [
        { text: "Image file: test.png", type: "text" },
        { data: "base64data", mediaType: "image/png", type: "file-data" },
      ],
    }),
  ],
  role: "tool",
};

describe("splitMultipartToolResults", () => {
  it("leaves messages with no media in tool results as they are", () => {
    const messages: ModelMessage[] = [
      { content: "Hello", role: "user" },
      {
        content: [
          toolResult("call_1", { type: "text", value: "File contents" }),
          toolResult("call_2", {
            type: "content",
            value: [{ text: "Only text", type: "text" }],
          }),
        ],
        role: "tool",
      },
    ];

    const result = splitMultipartToolResults({ messages, provider: "groq" });

    expect(result).toEqual(messages);
    expect(result[1]).toBe(messages[1]);
  });

  it("moves media into a user message right after its tool message, joining the text", () => {
    const messages: ModelMessage[] = [
      { content: "Before", role: "user" },
      {
        content: [
          toolResult("call_1", { type: "text", value: "Text file contents" }),
          toolResult("call_2", {
            type: "content",
            value: [
              { text: "First text", type: "text" },
              { text: "Second text", type: "text" },
              {
                data: "image-base64",
                mediaType: "image/png",
                type: "image-data",
              },
              {
                data: "pdf-base64",
                mediaType: "application/pdf",
                type: "file-data",
              },
            ],
          }),
        ],
        role: "tool",
      },
      { content: "After", role: "user" },
    ];

    expect(splitMultipartToolResults({ messages, provider: "groq" }))
      .toMatchInlineSnapshot(`
      [
        {
          "content": "Before",
          "role": "user",
        },
        {
          "content": [
            {
              "output": {
                "type": "text",
                "value": "Text file contents",
              },
              "toolCallId": "call_1",
              "toolName": "read_file",
              "type": "tool-result",
            },
            {
              "output": {
                "type": "text",
                "value": "First text
      Second text",
              },
              "toolCallId": "call_2",
              "toolName": "read_file",
              "type": "tool-result",
            },
          ],
          "role": "tool",
        },
        {
          "content": [
            {
              "data": "image-base64",
              "mediaType": "image/png",
              "type": "file",
            },
            {
              "data": "pdf-base64",
              "mediaType": "application/pdf",
              "type": "file",
            },
          ],
          "role": "user",
        },
        {
          "content": "After",
          "role": "user",
        },
      ]
    `);
  });

  it.each(["anthropic", "openai", "instrument"] as const)(
    "keeps media in tool results for %s, which takes it there",
    (provider) => {
      const messages = [imageResult];
      expect(splitMultipartToolResults({ messages, provider })).toBe(messages);
    },
  );
});
