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
  it("leaves out a call the provider ran and never answered", async () => {
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

  it("answers a call of ours the turn left without a result as stopped", async () => {
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
            {
              "input": undefined,
              "providerExecuted": false,
              "toolCallId": "call_456",
              "toolName": "read_file",
              "type": "tool-call",
            },
          ],
          "role": "assistant",
        },
        {
          "content": [
            {
              "output": {
                "type": "error-text",
                "value": "This call was stopped before it returned: it never ran, or was interrupted while it ran.",
              },
              "toolCallId": "call_456",
              "toolName": "read_file",
              "type": "tool-result",
            },
          ],
          "role": "tool",
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
              yieldMs: 5000,
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
              omittedBytes: 0,
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
                "yieldMs": 5000,
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

  it("replays persisted tool output byte for byte", async () => {
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
              status: "tabs",
              tabs: [
                {
                  id: "t1",
                  openedBy: "task",
                  title: "Example",
                  url: "https://example.com",
                },
              ],
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
      Your browser is these tabs of the user's chat, first one first: t1 at https://example.com ("Example"), which you opened. \`agent-browser\` starts on the first; \`agent-browser tab <id>\` switches to another, and \`agent-browser tab list\` shows them all.
      </instrument-system-note>",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  it("repeats an unchanged event note, which is a different turn's news", async () => {
    const first = baseMetadata();
    const second = baseMetadata();
    const gap = { minutes: 90 };

    function asked(
      ids: ReturnType<typeof baseMetadata>,
      text: string,
    ): SessionMessage.WithParts {
      return {
        id: ids.messageId,
        metadata: ids.messageMetadata,
        parts: [
          { metadata: ids.partMetadata, state: "done", text, type: "text" },
          {
            data: gap,
            metadata: { ...ids.partMetadata, id: StoreId.newPartId() },
            type: "data-messageGap",
          },
        ],
        role: "user",
      };
    }

    const result = await SessionMessage.toModelMessages(
      [asked(first, "Back."), asked(second, "Back again.")],
      TOOLS_FOR_MODEL_OUTPUT,
    );
    const notes = result.filter((message) =>
      JSON.stringify(message.content).includes("last wrote"),
    );
    expect(notes).toHaveLength(2);
  });

  it("does not repeat unchanged browser status", async () => {
    const first = baseMetadata();
    const second = baseMetadata();
    const browserStatus = {
      status: "tabs" as const,
      tabs: [
        {
          id: "t1",
          openedBy: "task" as const,
          title: "Example",
          url: "https://example.com",
        },
      ],
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
      Your browser is these tabs of the user's chat, first one first: t1 at https://example.com ("Example"), which you opened. \`agent-browser\` starts on the first; \`agent-browser tab <id>\` switches to another, and \`agent-browser tab list\` shows them all.
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

  // The same screen on two messages in a row is one note, the way the
  // browser status and the pane's tabs are: the second message says nothing
  // the agent has not already read, and a page's excerpt is the longest
  // thing a message carries.
  it("does not repeat an unchanged screen note", async () => {
    const viewing = (metadata: ReturnType<typeof baseMetadata>) => ({
      data: { screen: "home" as const, url: "/new-tab" },
      metadata: { ...metadata.partMetadata, id: StoreId.newPartId() },
      type: "data-viewContext" as const,
    });
    const first = baseMetadata();
    const second = baseMetadata();
    const third = baseMetadata();

    const result = await SessionMessage.toModelMessages(
      [
        {
          id: first.messageId,
          metadata: first.messageMetadata,
          parts: [
            { metadata: first.partMetadata, text: "one", type: "text" },
            viewing(first),
          ],
          role: "user",
        },
        {
          id: second.messageId,
          metadata: second.messageMetadata,
          parts: [
            { metadata: second.partMetadata, text: "two", type: "text" },
            viewing(second),
          ],
          role: "user",
        },
        {
          id: third.messageId,
          metadata: third.messageMetadata,
          parts: [
            { metadata: third.partMetadata, text: "three", type: "text" },
            {
              ...viewing(third),
              data: { screen: "tasks" as const, tasks: [] },
            },
          ],
          role: "user",
        },
      ],
      TOOLS_FOR_MODEL_OUTPUT,
    );

    const notes = result.map((message) =>
      JSON.stringify(message.content).includes("When the user sent this"),
    );
    expect(notes).toEqual([true, false, true]);
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

  it("tags dictated words for the model and says what the tag means", async () => {
    const { messageId, messageMetadata, partMetadata } = baseMetadata();

    const messages: SessionMessage.WithParts[] = [
      {
        id: messageId,
        metadata: messageMetadata,
        parts: [
          {
            metadata: partMetadata,
            state: "done",
            text: "Compare these\n[and check help scout too](dictated:)",
            type: "text",
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
              "text": "Compare these
      <dictated>and check help scout too</dictated>",
              "type": "text",
            },
            {
              "text": "</user_message>",
              "type": "text",
            },
            {
              "text": "The words in <dictated> tags were spoken and transcribed, so a word that doesn't fit may be one that sounds like the word the user meant.",
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

  // The stored words are the person's; the model is told who stopped the
  // call and that the stop stands, or it runs the call again on the next
  // message whatever that message says.
  it.each([
    {
      errorText: "This action was stopped by you.",
      stoppedBy: undefined,
      text: "The user stopped this. Do not run it again unless they ask.",
    },
    {
      errorText: "This action was stopped by you.",
      stoppedBy: "agent" as const,
      text: "The conversation that started this task stopped this. Do not run it again unless it asks.",
    },
    {
      errorText: "This action was stopped because it took too long.",
      stoppedBy: undefined,
      text: "This action was stopped because it took too long.",
    },
  ])(
    "tells the model of a stopped call as $text",
    async ({ errorText, stoppedBy, text }) => {
      const { sessionId } = baseMetadata();
      const assistantMessageId = StoreId.newMessageId();
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
              errorText,
              input: { command: "sleep 60", yieldMs: 30_000 },
              metadata: {
                createdAt: mockDate,
                endedAt: mockDate,
                id: StoreId.newPartId(),
                messageId: assistantMessageId,
                sessionId,
                ...(stoppedBy ? { stoppedBy } : {}),
              },
              state: "output-error",
              toolCallId: StoreId.ToolCallSchema.parse("call_stop"),
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

      expect(
        result.flatMap((message): unknown[] =>
          typeof message.content === "string" ? [] : message.content,
        ),
      ).toContainEqual(
        expect.objectContaining({
          output: { type: "error-text", value: text },
          type: "tool-result",
        }),
      );
    },
  );

  // A folder sent with a message is granted to the chat and told to the
  // agent by the folder changes note; the message itself prints nothing about
  // it, whatever an older build stored on the part.
  it("prints nothing for a folder sent with a message", async () => {
    const { messageMetadata, partMetadata } = baseMetadata();
    const storedPart = SessionMessagePart.coerce({
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
            storedPart,
            { metadata: partMetadata, text: "what is in here", type: "text" },
          ],
          role: "user",
        },
      ],
      TOOLS_FOR_MODEL_OUTPUT,
    );

    const text = JSON.stringify(result);
    expect(text).not.toContain("attached_folders");
    expect(text).not.toContain("/Users/sam/Downloads");
  });

  // An upload is kept in the chat's record folder while the agent's shell
  // starts in its work folder, so the note names an upload at its full path;
  // a file attached where it lay in the work folder keeps its relative path.
  it("lists a sent file at the path the agent reads it by", async () => {
    const { messageMetadata, partMetadata } = baseMetadata();
    const sentFiles = SessionMessagePart.coerce({
      data: {
        files: [
          {
            filename: "screen.png",
            filePath: "attachments/screen.png",
            mimeType: "image/png",
            modifiedAt: 1_718_198_400_000,
            size: 18_545,
          },
          {
            filename: "report.md",
            filePath: "work/report.md",
            mimeType: "text/markdown",
            modifiedAt: 1_718_198_400_000,
            size: 120,
          },
        ],
      },
      metadata: partMetadata,
      type: "data-attachments",
    });
    const messages = [
      {
        id: StoreId.newMessageId(),
        metadata: messageMetadata,
        parts: [
          sentFiles,
          { metadata: partMetadata, text: "what is this", type: "text" },
        ],
        role: "user",
      },
    ] satisfies SessionMessage.WithParts[];
    const uploadedFilesNote = async (
      options?: SessionMessage.ModelNoteOptions,
    ) => {
      const [message] = await SessionMessage.toModelMessages(
        messages,
        TOOLS_FOR_MODEL_OUTPUT,
        options,
      );
      const content = Array.isArray(message?.content) ? message.content : [];
      return content.flatMap((part) =>
        part.type === "text" && part.text.includes("<uploaded_files>")
          ? [part.text]
          : [],
      );
    };

    expect(
      await uploadedFilesNote({
        attachmentsDir: "/workspace/chats/c/attachments",
      }),
    ).toMatchInlineSnapshot(`
      [
        "<uploaded_files>
      The user uploaded these files with this message. They are now available at the paths listed below. Assume they are directly relevant to the user's request.
      - \`/workspace/chats/c/attachments/screen.png\` (18KB)
      - \`work/report.md\` (120B)
      </uploaded_files>",
      ]
    `);
    expect(await uploadedFilesNote()).toMatchInlineSnapshot(`
      [
        "<uploaded_files>
      The user uploaded these files with this message. They are now available at the paths listed below. Assume they are directly relevant to the user's request.
      - \`attachments/screen.png\` (18KB)
      - \`work/report.md\` (120B)
      </uploaded_files>",
      ]
    `);
  });

  // A file whose path was kept as the shell spelled it is named by that path
  // alone, so the note reads the same on every computer and after a move.
  it("names a file by the path it was sent at, whatever this computer's folders are", async () => {
    const { messageMetadata, partMetadata } = baseMetadata();
    const messages = [
      {
        id: StoreId.newMessageId(),
        metadata: messageMetadata,
        parts: [
          { metadata: partMetadata, text: "what is this", type: "text" },
          SessionMessagePart.coerce({
            data: {
              files: [
                {
                  agentPath:
                    "/Users/mac-user/Instrument/Chats/Trip/attachments/a.png",
                  filename: "a.png",
                  filePath: "attachments/a.png",
                  mimeType: "image/png",
                  modifiedAt: 0,
                  size: 10,
                },
                {
                  agentPath: "/Users/mac-user/Instrument/Notes/plan.md",
                  filename: "plan.md",
                  filePath: "workspace:/Notes/plan.md",
                  mimeType: "text/markdown",
                  modifiedAt: 0,
                  size: 10,
                },
              ],
            },
            metadata: partMetadata,
            type: "data-attachments",
          }),
        ],
        role: "user",
      },
    ] satisfies SessionMessage.WithParts[];
    const render = async (options: SessionMessage.ModelNoteOptions) =>
      JSON.stringify(
        await SessionMessage.toModelMessages(
          messages,
          TOOLS_FOR_MODEL_OUTPUT,
          options,
        ),
      );

    const here = await render({
      attachmentsDir:
        "/Users/mac-user/Instrument/.instrument/chats/c/attachments",
      workspaceRoot: "/Users/mac-user/Instrument",
    });
    expect(here).toContain(
      "/Users/mac-user/Instrument/Chats/Trip/attachments/a.png",
    );
    expect(
      await render({
        attachmentsDir:
          "/c/Users/windows-user/Instrument/.instrument/chats/c/attachments",
        shellPath: (hostPath) => hostPath.replaceAll("\\", "/"),
        workspaceRoot: "C:\\Users\\windows-user\\Instrument",
      }),
    ).toBe(here);
  });

  // A file in the workspace is kept by its place there, so the note names it
  // under the root of whichever computer the chat is read on, while one kept
  // at its absolute path by an earlier build is named as it was.
  it("names a file kept by its place in the workspace under this computer's root", async () => {
    const { messageMetadata, partMetadata } = baseMetadata();
    const messages = [
      {
        id: StoreId.newMessageId(),
        metadata: messageMetadata,
        parts: [
          SessionMessagePart.coerce({
            data: {
              files: [
                {
                  filename: "plan.md",
                  filePath: "workspace:/Notes/plan.md",
                  mimeType: "text/markdown",
                  modifiedAt: 1_718_198_400_000,
                  size: 120,
                },
                {
                  filename: "old.md",
                  filePath: "/Users/mac-user/Instrument/Notes/old.md",
                  mimeType: "text/markdown",
                  modifiedAt: 1_718_198_400_000,
                  size: 120,
                },
              ],
            },
            metadata: partMetadata,
            type: "data-attachments",
          }),
          { metadata: partMetadata, text: "read these", type: "text" },
        ],
        role: "user",
      },
    ] satisfies SessionMessage.WithParts[];
    const listed = async (options: SessionMessage.ModelNoteOptions) => {
      const [message] = await SessionMessage.toModelMessages(
        messages,
        TOOLS_FOR_MODEL_OUTPUT,
        options,
      );
      const content = Array.isArray(message?.content) ? message.content : [];
      return content
        .flatMap((part) => (part.type === "text" ? part.text.split("\n") : []))
        .filter((line) => line.startsWith("- "));
    };

    expect(await listed({ workspaceRoot: "/home/alex/Instrument" }))
      .toMatchInlineSnapshot(`
        [
          "- \`/home/alex/Instrument/Notes/plan.md\` (120B)",
          "- \`/Users/mac-user/Instrument/Notes/old.md\` (120B)",
        ]
      `);
    expect(
      await listed({
        shellPath: (hostPath) =>
          hostPath.replace(/^C:\\/, "/c/").replaceAll("\\", "/"),
        workspaceRoot: String.raw`C:\Users\alex\Instrument`,
      }),
    ).toMatchInlineSnapshot(`
      [
        "- \`/c/Users/alex/Instrument/Notes/plan.md\` (120B)",
        "- \`/Users/mac-user/Instrument/Notes/old.md\` (120B)",
      ]
    `);
  });

  // A tool's output schema outgrows the sessions already recorded against it,
  // and every one of those results is mapped again on each turn and each
  // transcript render. Reading a field the record predates used to fail the
  // whole conversion rather than the one result it could not describe.
  it("falls back to the raw output when a tool result predates its schema", async () => {
    const { messageId, messageMetadata, partMetadata } = baseMetadata();
    const legacyStoredPart = SessionMessagePart.coerce({
      input: { name: "barcodes" },
      metadata: { ...partMetadata, toolName: "load_skill" },
      output: { content: "# Barcodes", name: "barcodes" },
      state: "output-available",
      toolCallId: StoreId.ToolCallSchema.parse("call_legacy"),
      type: "tool-load_skill",
    });

    const result = await SessionMessage.toModelMessages(
      [
        {
          id: messageId,
          metadata: {
            ...messageMetadata,
            aiGatewayModel: undefined,
            finishReason: "tool-calls",
            modelId: "gpt-4o",
            providerId: "openai",
          },
          parts: [legacyStoredPart],
          role: "assistant",
        },
      ],
      TOOLS_FOR_MODEL_OUTPUT,
    );

    expect(result.at(-1)).toMatchInlineSnapshot(`
      {
        "content": [
          {
            "output": {
              "type": "json",
              "value": {
                "content": "# Barcodes",
                "name": "barcodes",
              },
            },
            "toolCallId": "call_legacy",
            "toolName": "load_skill",
            "type": "tool-result",
          },
        ],
        "role": "tool",
      }
    `);
  });

  it("injects a date correction on the user turn that recorded it", async () => {
    const { messageId, messageMetadata, partMetadata } = baseMetadata();

    const messages: SessionMessage.WithParts[] = [
      {
        id: messageId,
        metadata: messageMetadata,
        parts: [
          {
            metadata: partMetadata,
            state: "done",
            text: "Where were we?",
            type: "text",
          },
          {
            data: { date: "2024-01-02" },
            metadata: { ...partMetadata, id: StoreId.newPartId() },
            type: "data-dateChange",
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
              "text": "Where were we?",
              "type": "text",
            },
            {
              "text": "</user_message>",
              "type": "text",
            },
            {
              "text": "
      <instrument-system-note>
      Today is now Tuesday, January 2, 2024. This supersedes the current date in the system information above; that date is when this session began.
      </instrument-system-note>",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  // Skills the agent wrote are recorded on the assistant message of the turn
  // that wrote them, and reach the model on the next user turn: several turns
  // can run before the user speaks again, so every change is carried and each
  // is announced once.
  it("carries accumulated skill changes onto the next user turn only", async () => {
    const { sessionId } = baseMetadata();

    function messageOf(
      role: "assistant" | "user",
      part: (metadata: {
        createdAt: Date;
        id: StoreId.Part;
        messageId: StoreId.Message;
        sessionId: StoreId.Session;
      }) => SessionMessage.WithParts["parts"][number],
    ): SessionMessage.WithParts {
      const id = StoreId.newMessageId();
      const metadata = {
        createdAt: mockDate,
        id: StoreId.newPartId(),
        messageId: id,
        sessionId,
      };
      return role === "assistant"
        ? {
            id,
            metadata: {
              aiGatewayModel: undefined,
              createdAt: mockDate,
              finishReason: "stop",
              modelId: "gpt-4o",
              providerId: "openai",
              sessionId,
            },
            parts: [part(metadata)],
            role: "assistant",
          }
        : {
            id,
            metadata: { createdAt: mockDate, sessionId },
            parts: [part(metadata)],
            role: "user",
          };
    }

    const messages: SessionMessage.WithParts[] = [
      messageOf("assistant", (metadata) => ({
        data: {
          changes: [{ change: "added", kind: "skill", name: "pdf-report" }],
        },
        metadata,
        type: "data-setupChanges",
      })),
      messageOf("assistant", (metadata) => ({
        data: {
          changes: [
            { change: "changed", kind: "skill", name: "chart-builder" },
            { change: "added", kind: "skill", name: "pdf-report" },
          ],
        },
        metadata,
        type: "data-setupChanges",
      })),
      messageOf("user", (metadata) => ({
        metadata,
        state: "done",
        text: "Now run it.",
        type: "text",
      })),
      messageOf("user", (metadata) => ({
        metadata,
        state: "done",
        text: "And again.",
        type: "text",
      })),
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
              "text": "Now run it.",
              "type": "text",
            },
            {
              "text": "</user_message>",
              "type": "text",
            },
            {
              "text": "
      <instrument-system-note>
      You added the skill "pdf-report" to the workspace skills folder, so it is not in the skill catalog above. You changed the skill "chart-builder" in the workspace skills folder, so any catalog entry above describes an older version. \`load_skill\` accepts these names; load one to work from its current instructions rather than from what you remember writing.
      </instrument-system-note>",
              "type": "text",
            },
          ],
          "role": "user",
        },
        {
          "content": [
            {
              "text": "And again.",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  it("carries the output limit onto the next user turn", async () => {
    const { sessionId } = baseMetadata();

    function reply(
      part: (metadata: {
        createdAt: Date;
        id: StoreId.Part;
        messageId: StoreId.Message;
        sessionId: StoreId.Session;
      }) => SessionMessage.WithParts["parts"][number],
    ): SessionMessage.WithParts {
      const id = StoreId.newMessageId();
      return {
        id,
        metadata: {
          aiGatewayModel: undefined,
          createdAt: mockDate,
          finishReason: "length",
          modelId: "synthetic",
          providerId: "system",
          sessionId,
          synthetic: true,
        },
        parts: [
          part({
            createdAt: mockDate,
            id: StoreId.newPartId(),
            messageId: id,
            sessionId,
          }),
        ],
        role: "assistant",
      };
    }

    const asked = StoreId.newMessageId();
    const messages: SessionMessage.WithParts[] = [
      reply((metadata) => ({
        data: { continuations: 1 },
        metadata,
        type: "data-outputLimit",
      })),
      {
        id: asked,
        metadata: { createdAt: mockDate, sessionId },
        parts: [
          {
            metadata: {
              createdAt: mockDate,
              id: StoreId.newPartId(),
              messageId: asked,
              sessionId,
            },
            state: "done",
            text: "Carry on.",
            type: "text",
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
              "text": "Carry on.",
              "type": "text",
            },
            {
              "text": "</user_message>",
              "type": "text",
            },
            {
              "text": "
      <instrument-system-note>
      The previous run was cut off at the output limit 2 times in a row and stopped there, not because the task was finished. What was written is above. Pick up from where it stops, and write the rest in several short replies rather than one long one.
      </instrument-system-note>",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });
});

// A provider renamed or removed since a turn ran left that turn's model record
// unparsable, and failing it failed the read of the whole session.
describe("SessionMessage.Schema", () => {
  it("reads a past turn whose model names a provider this build does not know", () => {
    const { messageId, sessionId } = baseMetadata();
    const model = {
      author: "openai",
      canonicalId: "gpt-5.6-sol",
      features: [],
      name: "GPT-5.6 Sol",
      params: { provider: "retired-provider", providerConfigId: "gone" },
      providerId: "gpt-5.6-sol",
      providerName: "Retired",
      tags: [],
      uri: "openai/gpt-5.6-sol?provider=retired-provider&providerConfigId=gone",
    };

    const message = SessionMessage.Schema.parse({
      id: messageId,
      metadata: {
        aiGatewayModel: model,
        aiGatewayModelServed: model,
        createdAt: mockDate,
        modelId: "gpt-5.6-sol",
        providerId: "retired-provider",
        realRole: "assistant",
        sessionId,
      },
      role: "assistant",
    });

    expect(message.metadata).toMatchObject({
      aiGatewayModel: undefined,
      aiGatewayModelServed: undefined,
      modelId: "gpt-5.6-sol",
    });
  });
});
