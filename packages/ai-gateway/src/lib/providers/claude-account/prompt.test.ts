import { describe, expect, it } from "vitest";

import {
  coldStartContent,
  splitSystemPrompt,
  toolResultToMCP,
  turnContent,
} from "./prompt";

describe("splitSystemPrompt", () => {
  it("takes the leading system messages as the prompt and leaves later ones in place", () => {
    const { rest, systemPrompt } = splitSystemPrompt([
      { content: "one", role: "system" },
      { content: "two", role: "system" },
      { content: [{ text: "hi", type: "text" }], role: "user" },
      { content: "late", role: "system" },
    ]);
    expect(systemPrompt).toBe("one\n\ntwo");
    expect(rest.map((message) => message.role)).toEqual(["user", "system"]);
  });
});

describe("turnContent", () => {
  it("sends a correction riding with a turn as text beside it", () => {
    expect(
      turnContent([
        { content: "date changed", role: "system" },
        {
          content: [
            { text: "hello", type: "text" },
            {
              data: { data: "aGk=", type: "data" },
              mediaType: "image/png",
              type: "file",
            },
          ],
          role: "user",
        },
      ]),
    ).toMatchInlineSnapshot(`
      [
        {
          "text": "date changed",
          "type": "text",
        },
        {
          "text": "hello",
          "type": "text",
        },
        {
          "source": {
            "data": "aGk=",
            "media_type": "image/png",
            "type": "base64",
          },
          "type": "image",
        },
      ]
    `);
  });
});

describe("coldStartContent", () => {
  it("replays earlier turns as a transcript ahead of the new one", () => {
    const blocks = coldStartContent([
      { content: [{ text: "list files", type: "text" }], role: "user" },
      {
        content: [
          {
            input: { command: "ls" },
            toolCallId: "call_1",
            toolName: "bash",
            type: "tool-call",
          },
        ],
        role: "assistant",
      },
      {
        content: [
          {
            output: { type: "text", value: "a.txt" },
            toolCallId: "call_1",
            toolName: "bash",
            type: "tool-result",
          },
        ],
        role: "tool",
      },
      { content: [{ text: "one file", type: "text" }], role: "assistant" },
      { content: [{ text: "and now?", type: "text" }], role: "user" },
    ]);
    expect(blocks).toMatchInlineSnapshot(`
      [
        {
          "text": "<conversation_history>
      <user>
      list files
      </user>
      <assistant>
      <tool_call id="call_1" name="bash">{"command":"ls"}</tool_call>
      </assistant>
      <tool_result id="call_1">a.txt</tool_result>
      <assistant>
      one file
      </assistant>
      </conversation_history>
      The conversation so far is above. The new message follows.",
          "type": "text",
        },
        {
          "text": "and now?",
          "type": "text",
        },
      ]
    `);
  });

  it("asks to carry on when the replay ends on tool results", () => {
    const [block] = coldStartContent([
      { content: [{ text: "go", type: "text" }], role: "user" },
      {
        content: [
          {
            output: { type: "error-text", value: "refused" },
            toolCallId: "call_1",
            toolName: "bash",
            type: "tool-result",
          },
        ],
        role: "tool",
      },
    ]);
    expect(block?.type === "text" && block.text).toContain(
      "Continue from the last tool results above.",
    );
  });
});

describe("toolResultToMCP", () => {
  it.each([
    [{ type: "text", value: "ok" }, false],
    [{ type: "json", value: { a: 1 } }, false],
    [{ type: "error-text", value: "no" }, true],
    [{ reason: "denied", type: "execution-denied" }, true],
  ] as const)("marks %j as an error: %s", (output, isError) => {
    expect(Boolean(toolResultToMCP(output).isError)).toBe(isError);
  });

  it("carries an image a tool returned as MCP image content", () => {
    expect(
      toolResultToMCP({
        type: "content",
        value: [
          { text: "shot", type: "text" },
          {
            data: { data: "aGk=", type: "data" },
            mediaType: "image/png",
            type: "file",
          },
        ],
      }).content,
    ).toEqual([
      { text: "shot", type: "text" },
      { data: "aGk=", mimeType: "image/png", type: "image" },
    ]);
  });
});
