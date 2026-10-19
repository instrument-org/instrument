import { describe, expect, it } from "vitest";

import {
  coldStartContent,
  replayFrames,
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

describe("replayFrames", () => {
  it("tells our history as Claude's own, with tool calls, results and images intact", () => {
    expect(
      replayFrames(
        [
          { content: [{ text: "look at it", type: "text" }], role: "user" },
          {
            content: [
              {
                providerOptions: {
                  "claude-account": {
                    model: "claude-sonnet-5-5",
                    signature: "sig",
                  },
                },
                text: "I should look.",
                type: "reasoning",
              },
              { text: "Looking.", type: "text" },
              {
                input: { view: "a" },
                toolCallId: "toolu_1",
                toolName: "screenshot",
                type: "tool-call",
              },
            ],
            role: "assistant",
          },
          {
            content: [
              {
                output: {
                  type: "content",
                  value: [
                    { text: "view a", type: "text" },
                    {
                      data: { data: "aGk=", type: "data" },
                      mediaType: "image/png",
                      type: "file",
                    },
                  ],
                },
                toolCallId: "toolu_1",
                toolName: "screenshot",
                type: "tool-result",
              },
            ],
            role: "tool",
          },
          { content: "date changed", role: "system" },
          { content: [{ text: "what color?", type: "text" }], role: "user" },
        ],
        "mcp__instrument__",
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "text": "look at it",
              "type": "text",
            },
          ],
          "role": "user",
        },
        {
          "content": [
            {
              "signature": "sig",
              "thinking": "I should look.",
              "type": "thinking",
            },
            {
              "text": "Looking.",
              "type": "text",
            },
            {
              "id": "toolu_1",
              "input": {
                "view": "a",
              },
              "name": "mcp__instrument__screenshot",
              "type": "tool_use",
            },
          ],
          "model": "claude-sonnet-5-5",
          "role": "assistant",
        },
        {
          "content": [
            {
              "content": [
                {
                  "text": "view a",
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
              ],
              "tool_use_id": "toolu_1",
              "type": "tool_result",
            },
            {
              "text": "date changed",
              "type": "text",
            },
            {
              "text": "what color?",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  it("leaves out reasoning Claude did not sign, and answers a call that never finished", () => {
    expect(
      replayFrames(
        [
          { content: [{ text: "go", type: "text" }], role: "user" },
          {
            content: [
              { text: "from another model", type: "reasoning" },
              {
                input: {},
                toolCallId: "functions.bash:0",
                toolName: "bash",
                type: "tool-call",
              },
            ],
            role: "assistant",
          },
          { content: [{ text: "never mind", type: "text" }], role: "user" },
        ],
        "mcp__instrument__",
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "text": "go",
              "type": "text",
            },
          ],
          "role": "user",
        },
        {
          "content": [
            {
              "id": "toolu_8497fe9cce69aff0aa7025efd9339081215bcf45",
              "input": {},
              "name": "mcp__instrument__bash",
              "type": "tool_use",
            },
          ],
          "model": undefined,
          "role": "assistant",
        },
        {
          "content": [
            {
              "content": "The call did not finish.",
              "is_error": true,
              "tool_use_id": "toolu_8497fe9cce69aff0aa7025efd9339081215bcf45",
              "type": "tool_result",
            },
            {
              "text": "never mind",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  it("refuses history that ends on the assistant's side", () => {
    expect(() =>
      replayFrames(
        [
          { content: [{ text: "hi", type: "text" }], role: "user" },
          { content: [{ text: "hello", type: "text" }], role: "assistant" },
        ],
        "mcp__instrument__",
      ),
    ).toThrow("neither starts nor ends");
  });
});
