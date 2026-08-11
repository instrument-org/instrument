import { describe, expect, it } from "vitest";

import { TOOLS_FOR_MODEL_OUTPUT } from "../../tools/all";
import { RelativePathSchema } from "../paths";
import { StoreId } from "../store-id";
import { SessionMessage } from "./message";
import { SessionMessagePart } from "./message-part";

const mockDate = new Date("2024-01-01T10:00:00Z");

function baseMetadata() {
  const messageId = StoreId.newMessageId();
  const sessionId = StoreId.newSessionId();
  return {
    messageId,
    messageMetadata: {
      createdAt: mockDate,
      sessionId,
    },
    partMetadata: {
      createdAt: mockDate,
      id: StoreId.newPartId(),
      messageId,
      sessionId,
    },
    sessionId,
  };
}

describe("SessionMessage.toModelMessages", () => {
  it("excludes tool parts in input-available (preliminary) state", async () => {
    const { messageId, messageMetadata, partMetadata } = baseMetadata();

    const messages: SessionMessage.WithParts[] = [
      {
        id: messageId,
        metadata: {
          ...messageMetadata,
          aiGatewayModel: undefined,
          finishReason: "tool-calls",
          modelId: "gpt-4o",
          providerId: "openai",
        },
        parts: [
          {
            metadata: partMetadata,
            state: "done",
            text: "Let me read that file.",
            type: "text",
          },
          {
            callProviderMetadata: undefined,
            input: { filePath: "test.txt" },
            metadata: { ...partMetadata, toolName: "read_file" },
            providerExecuted: true,
            state: "input-available",
            toolCallId: StoreId.ToolCallSchema.parse("call_123"),
            type: "tool-read_file",
          },
        ],
        role: "assistant",
      },
    ];

    const result = await SessionMessage.toModelMessages(
      messages,
      TOOLS_FOR_MODEL_OUTPUT,
    );

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "text": "Let me read that file.",
              "type": "text",
            },
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  it("excludes tool parts in input-streaming (preliminary) state", async () => {
    const { messageId, messageMetadata, partMetadata } = baseMetadata();

    const messages: SessionMessage.WithParts[] = [
      {
        id: messageId,
        metadata: {
          ...messageMetadata,
          aiGatewayModel: undefined,
          finishReason: "tool-calls",
          modelId: "gpt-4o",
          providerId: "openai",
        },
        parts: [
          {
            metadata: partMetadata,
            state: "done",
            text: "Thinking...",
            type: "text",
          },
          {
            input: undefined,
            metadata: { ...partMetadata, toolName: "read_file" },
            providerExecuted: false,
            state: "input-streaming",
            toolCallId: StoreId.ToolCallSchema.parse("call_456"),
            type: "tool-read_file",
          },
        ],
        role: "assistant",
      },
    ];

    const result = await SessionMessage.toModelMessages(
      messages,
      TOOLS_FOR_MODEL_OUTPUT,
    );

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "text": "Thinking...",
              "type": "text",
            },
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  it("includes tool parts in output-available (preliminary) state", async () => {
    const { sessionId } = baseMetadata();

    const assistantMessageId = StoreId.newMessageId();
    const toolCallId = StoreId.ToolCallSchema.parse("call_789");

    const messages: SessionMessage.WithParts[] = [
      {
        id: assistantMessageId,
        metadata: {
          aiGatewayModel: undefined,
          createdAt: mockDate,
          finishReason: "tool-calls",
          modelId: "gpt-4o",
          providerId: "openai",
          sessionId,
        },
        parts: [
          {
            callProviderMetadata: undefined,
            input: {
              command: "sleep 5",
              explanation: "Test command",
              timeoutMs: 5000,
            },
            metadata: {
              createdAt: mockDate,
              endedAt: new Date("2024-01-01T10:01:00Z"),
              id: StoreId.newPartId(),
              messageId: assistantMessageId,
              sessionId,
              toolName: "bash",
            },
            output: {
              command: "sleep 5",
              commands: ["sleep"],
              durationMs: 0,
              exitCode: 0,
              output: "",
            },
            preliminary: true,
            providerExecuted: true,
            state: "output-available",
            toolCallId,
            type: "tool-bash",
          },
        ],
        role: "assistant",
      },
    ];

    const result = await SessionMessage.toModelMessages(
      messages,
      TOOLS_FOR_MODEL_OUTPUT,
    );

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "input": {
                "command": "sleep 5",
                "explanation": "Test command",
                "timeoutMs": 5000,
              },
              "providerExecuted": true,
              "toolCallId": "call_789",
              "toolName": "bash",
              "type": "tool-call",
            },
            {
              "output": {
                "type": "text",
                "value": "Exit code: 0

      The command produced no output on stdout or stderr.

      Duration: 0 ms",
              },
              "toolCallId": "call_789",
              "toolName": "bash",
              "type": "tool-result",
            },
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  it("replays persisted bounded tool output byte for byte", async () => {
    const { sessionId } = baseMetadata();
    const messageId = StoreId.newMessageId();
    const toolCallId = StoreId.ToolCallSchema.parse("call_search_replay");
    const messages: SessionMessage.WithParts[] = [
      {
        id: messageId,
        metadata: {
          aiGatewayModel: undefined,
          createdAt: mockDate,
          finishReason: "tool-calls",
          modelId: "gpt-4o",
          providerId: "openai",
          sessionId,
        },
        parts: [
          {
            callProviderMetadata: undefined,
            input: { query: "cache stability" },
            metadata: {
              createdAt: mockDate,
              endedAt: mockDate,
              id: StoreId.newPartId(),
              messageId,
              sessionId,
              toolName: "web_search",
            },
            output: {
              results: {
                kind: "summary",
                modelId: "test-model",
                provider: {
                  displayName: "Test",
                  id: "instrument",
                  type: "openai",
                },
                sources: [],
                text: "Stable result",
                usage: {},
              },
              state: "success",
            },
            providerExecuted: true,
            state: "output-available",
            toolCallId,
            type: "tool-web_search",
          },
        ],
        role: "assistant",
      },
    ];

    const first = await SessionMessage.toModelMessages(
      messages,
      TOOLS_FOR_MODEL_OUTPUT,
    );
    const replay = await SessionMessage.toModelMessages(
      messages,
      TOOLS_FOR_MODEL_OUTPUT,
    );

    expect(replay).toEqual(first);
    expect(JSON.stringify(first)).toMatch(/nonce=[0-9a-f]{32}/);
  });

  it("injects browser status on a user message", async () => {
    const { messageId, messageMetadata, partMetadata } = baseMetadata();

    const messages: SessionMessage.WithParts[] = [
      {
        id: messageId,
        metadata: messageMetadata,
        parts: [
          {
            metadata: partMetadata,
            state: "done",
            text: "Continue in the browser.",
            type: "text",
          },
          {
            data: {
              status: "open",
              target: {
                title: "Example",
                url: "https://example.com",
              },
            },
            metadata: { ...partMetadata, id: StoreId.newPartId() },
            type: "data-browserStatus",
          },
        ],
        role: "user",
      },
    ];

    const result = await SessionMessage.toModelMessages(
      messages,
      TOOLS_FOR_MODEL_OUTPUT,
    );

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "text": "<user_message>",
              "type": "text",
            },
            {
              "text": "Continue in the browser.",
              "type": "text",
            },
            {
              "text": "</user_message>",
              "type": "text",
            },
            {
              "text": "
      <instrument-system-note>
      An in-app browser tab is already open for this task (opened by you or the user). Current URL: https://example.com. Page title: Example. Drive it with \`agent-browser\`.
      </instrument-system-note>",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  it("injects closed browser status on a user message", async () => {
    const { messageId, messageMetadata, partMetadata } = baseMetadata();

    const messages: SessionMessage.WithParts[] = [
      {
        id: messageId,
        metadata: messageMetadata,
        parts: [
          {
            metadata: partMetadata,
            state: "done",
            text: "Continue where you left off.",
            type: "text",
          },
          {
            data: {
              previousTarget: {
                title: "Example",
                url: "https://example.com/work",
              },
              status: "closed",
            },
            metadata: { ...partMetadata, id: StoreId.newPartId() },
            type: "data-browserStatus",
          },
        ],
        role: "user",
      },
    ];

    const result = await SessionMessage.toModelMessages(
      messages,
      TOOLS_FOR_MODEL_OUTPUT,
    );

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "text": "<user_message>",
              "type": "text",
            },
            {
              "text": "Continue where you left off.",
              "type": "text",
            },
            {
              "text": "</user_message>",
              "type": "text",
            },
            {
              "text": "
      <instrument-system-note>
      This session previously had an in-app browser tab open, but it is no longer open. Last known URL: https://example.com/work. Page title: Example. If browser work needs to continue, use \`agent-browser\` to reopen the relevant page and restore any required page state before proceeding.
      </instrument-system-note>",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  it("does not repeat unchanged browser status", async () => {
    const first = baseMetadata();
    const second = baseMetadata();
    const browserStatus = {
      status: "open" as const,
      target: {
        title: "Example",
        url: "https://example.com",
      },
    };

    const messages: SessionMessage.WithParts[] = [
      {
        id: first.messageId,
        metadata: first.messageMetadata,
        parts: [
          {
            metadata: first.partMetadata,
            state: "done",
            text: "First message.",
            type: "text",
          },
          {
            data: browserStatus,
            metadata: {
              ...first.partMetadata,
              id: StoreId.newPartId(),
            },
            type: "data-browserStatus",
          },
        ],
        role: "user",
      },
      {
        id: second.messageId,
        metadata: second.messageMetadata,
        parts: [
          {
            metadata: second.partMetadata,
            state: "done",
            text: "Second message.",
            type: "text",
          },
          {
            data: browserStatus,
            metadata: {
              ...second.partMetadata,
              id: StoreId.newPartId(),
            },
            type: "data-browserStatus",
          },
        ],
        role: "user",
      },
    ];

    const result = await SessionMessage.toModelMessages(
      messages,
      TOOLS_FOR_MODEL_OUTPUT,
    );

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "text": "<user_message>",
              "type": "text",
            },
            {
              "text": "First message.",
              "type": "text",
            },
            {
              "text": "</user_message>",
              "type": "text",
            },
            {
              "text": "
      <instrument-system-note>
      An in-app browser tab is already open for this task (opened by you or the user). Current URL: https://example.com. Page title: Example. Drive it with \`agent-browser\`.
      </instrument-system-note>",
              "type": "text",
            },
          ],
          "role": "user",
        },
        {
          "content": [
            {
              "text": "Second message.",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  it("normalizes a skill mention to /name and footnotes it", async () => {
    const { messageId, messageMetadata, partMetadata } = baseMetadata();

    const messages: SessionMessage.WithParts[] = [
      {
        id: messageId,
        metadata: messageMetadata,
        parts: [
          {
            metadata: partMetadata,
            state: "done",
            text: "Use [$tdd](skill:tdd) to write the tests.",
            type: "text",
          },
          {
            data: { names: ["tdd"] },
            metadata: { ...partMetadata, id: StoreId.newPartId() },
            type: "data-skillMentions",
          },
        ],
        role: "user",
      },
    ];

    const result = await SessionMessage.toModelMessages(
      messages,
      TOOLS_FOR_MODEL_OUTPUT,
    );

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "text": "<user_message>",
              "type": "text",
            },
            {
              "text": "Use /tdd to write the tests.",
              "type": "text",
            },
            {
              "text": "</user_message>",
              "type": "text",
            },
            {
              "text": "Skill reference in the message above: \`/tdd\` (the installed skill "tdd"). Load it with \`load_skill\` before relying on it, and don't describe a skill from its name alone.",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  it("includes tool parts in output-available state", async () => {
    const { sessionId } = baseMetadata();

    const assistantMessageId = StoreId.newMessageId();
    const toolCallId = StoreId.ToolCallSchema.parse("call_789");

    const messages: SessionMessage.WithParts[] = [
      {
        id: assistantMessageId,
        metadata: {
          aiGatewayModel: undefined,
          createdAt: mockDate,
          finishReason: "tool-calls",
          modelId: "gpt-4o",
          providerId: "openai",
          sessionId,
        },
        parts: [
          {
            callProviderMetadata: undefined,
            input: { filePath: "test.txt" },
            metadata: {
              createdAt: mockDate,
              endedAt: new Date("2024-01-01T10:01:00Z"),
              id: StoreId.newPartId(),
              messageId: assistantMessageId,
              sessionId,
              toolName: "read_file",
            },
            output: {
              content: "file contents",
              displayedLines: 1,
              filePath: RelativePathSchema.parse("test.txt"),
              hasMoreLines: false,
              modifiedAt: 1_234_567_890,
              offset: 0,
              state: "exists",
              totalLines: 1,
              truncatedByBytes: false,
            },
            providerExecuted: true,
            state: "output-available",
            toolCallId,
            type: "tool-read_file",
          },
        ],
        role: "assistant",
      },
    ];

    const result = await SessionMessage.toModelMessages(
      messages,
      TOOLS_FOR_MODEL_OUTPUT,
    );

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "input": {
                "filePath": "test.txt",
              },
              "providerExecuted": true,
              "toolCallId": "call_789",
              "toolName": "read_file",
              "type": "tool-call",
            },
            {
              "output": {
                "type": "text",
                "value": "<path>test.txt</path>
      <content>
         0→file contents
      </content>",
              },
              "toolCallId": "call_789",
              "toolName": "read_file",
              "type": "tool-result",
            },
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  // Assembling a turn reads a folder's mount name to build its /mnt path, and
  // a part that reached here without one crashed the whole turn rather than
  // losing a line. Store migrations are what guarantee the field is there; this
  // is the reader holding up its end.
  it("builds an attached folder's mount path when replaying a turn", async () => {
    const { messageMetadata, partMetadata } = baseMetadata();
    const legacyStoredPart = SessionMessagePart.coerce({
      data: {
        files: [],
        folders: [
          {
            access: "read-write",
            createdAt: 1_718_198_400_000,
            id: "01KZ9NPNZZPQF80Z7A7DG4Z5BN",
            mountName: "Home-Downloads",
            path: "/Users/sam/Downloads",
            source: "user",
          },
        ],
      },
      metadata: partMetadata,
      type: "data-attachments",
    });

    const result = await SessionMessage.toModelMessages(
      [
        {
          id: StoreId.newMessageId(),
          metadata: messageMetadata,
          parts: [
            legacyStoredPart,
            { metadata: partMetadata, text: "what is in here", type: "text" },
          ],
          role: "user",
        },
      ],
      TOOLS_FOR_MODEL_OUTPUT,
    );

    const text = JSON.stringify(result);
    expect(text).toContain("/mnt/Home-Downloads");
    expect(text).not.toContain("/mnt/undefined");
  });
});
