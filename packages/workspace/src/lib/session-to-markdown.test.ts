import { describe, expect, it } from "vitest";

import { Session } from "../schemas/session";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import {
  buildSessionFrontMatter,
  renderAssistantMetadata,
  renderToolInput,
  renderToolOutput,
  sessionToMarkdown,
} from "./session-to-markdown";

const sessionId = StoreId.SessionSchema.parse("ses_01J00000000000000000000000");
const contextMessageId = StoreId.MessageSchema.parse(
  "msg_01J00000000000000000000000",
);
const agentContextMessageId = StoreId.MessageSchema.parse(
  "msg_01J00000000000000000000003",
);
const userMessageId = StoreId.MessageSchema.parse(
  "msg_01J00000000000000000000001",
);
const assistantMessageId = StoreId.MessageSchema.parse(
  "msg_01J00000000000000000000002",
);
const contextPartId = StoreId.PartSchema.parse(
  "prt_01J00000000000000000000000",
);
const agentContextPartId = StoreId.PartSchema.parse(
  "prt_01J00000000000000000000001",
);
const userPartId = StoreId.PartSchema.parse("prt_01J00000000000000000000002");
const userSecondPartId = StoreId.PartSchema.parse(
  "prt_01J00000000000000000000008",
);
const stepPartId = StoreId.PartSchema.parse("prt_01J00000000000000000000003");
const sourcePartId = StoreId.PartSchema.parse("prt_01J00000000000000000000004");
const skillChangesPartId = StoreId.PartSchema.parse(
  "prt_01J00000000000000000000005",
);
const toolPartId = StoreId.PartSchema.parse("prt_01J00000000000000000000006");
const maxStepsPartId = StoreId.PartSchema.parse(
  "prt_01J00000000000000000000007",
);

const session = Session.WithMessagesAndPartsSchema.parse({
  createdAt: new Date("2026-07-24T10:00:00.000Z"),
  id: sessionId,
  messages: [
    {
      id: contextMessageId,
      metadata: {
        agentName: "task",
        createdAt: new Date("2026-07-24T10:00:01.000Z"),
        realRole: "system",
        sessionId,
      },
      parts: [
        {
          metadata: {
            createdAt: new Date("2026-07-24T10:00:01.000Z"),
            id: contextPartId,
            messageId: contextMessageId,
            sessionId,
          },
          text: "Persisted system prompt",
          type: "text",
        },
      ],
      role: "session-context",
    },
    {
      id: agentContextMessageId,
      metadata: {
        agentName: "task",
        createdAt: new Date("2026-07-24T10:00:01.000Z"),
        realRole: "user",
        sessionId,
      },
      parts: [
        {
          metadata: {
            createdAt: new Date("2026-07-24T10:00:01.000Z"),
            id: agentContextPartId,
            messageId: agentContextMessageId,
            sessionId,
          },
          text: "Persisted harness context",
          type: "text",
        },
      ],
      role: "session-context",
    },
    {
      id: userMessageId,
      metadata: {
        createdAt: new Date("2026-07-24T10:00:02.000Z"),
        sessionId,
      },
      parts: [
        {
          metadata: {
            createdAt: new Date("2026-07-24T10:00:02.000Z"),
            id: userPartId,
            messageId: userMessageId,
            sessionId,
          },
          text: "Human question",
          type: "text",
        },
        {
          metadata: {
            createdAt: new Date("2026-07-24T10:00:02.000Z"),
            id: userSecondPartId,
            messageId: userMessageId,
            sessionId,
          },
          text: "<attached_folders>\n- one\n</attached_folders>",
          type: "text",
        },
      ],
      role: "user",
    },
    {
      id: assistantMessageId,
      metadata: {
        completionTokensPerSecond: 12.5,
        createdAt: new Date("2026-07-24T10:00:03.000Z"),
        endedAt: new Date("2026-07-24T10:00:05.000Z"),
        error: {
          kind: "api-call",
          message: "Provider request failed",
          name: "APIError",
          statusCode: 500,
          url: "https://provider.example/v1/responses",
        },
        finishReason: "error",
        modelId: "debug-model",
        msToFinish: 2000,
        msToFirstChunk: 250,
        providerId: "debug-provider",
        sessionId,
        usage: {
          inputTokenDetails: {
            cacheReadTokens: 40,
            cacheWriteTokens: 10,
            noCacheTokens: 50,
          },
          inputTokens: 100,
          outputTokenDetails: {
            reasoningTokens: 5,
            textTokens: 15,
          },
          outputTokens: 20,
          totalTokens: 120,
        },
      },
      parts: [
        {
          metadata: {
            createdAt: new Date("2026-07-24T10:00:03.000Z"),
            id: stepPartId,
            messageId: assistantMessageId,
            sessionId,
            stepCount: 2,
          },
          type: "step-start",
        },
        {
          metadata: {
            createdAt: new Date("2026-07-24T10:00:04.000Z"),
            id: sourcePartId,
            messageId: assistantMessageId,
            sessionId,
          },
          sourceId: "source-1",
          title: "Provider documentation",
          type: "source-url",
          url: "https://provider.example/docs",
        },
        {
          data: { created: ["pdf-report"], updated: [] },
          metadata: {
            createdAt: new Date("2026-07-24T10:00:04.500Z"),
            id: skillChangesPartId,
            messageId: assistantMessageId,
            sessionId,
          },
          type: "data-skillChanges",
        },
        {
          input: {
            command: "pnpm test",
            explanation: "Run tests",
            timeoutMs: 120_000,
          },
          metadata: {
            createdAt: new Date("2026-07-24T10:00:05.000Z"),
            id: toolPartId,
            messageId: assistantMessageId,
            sessionId,
          },
          rawInput: "{",
          state: "input-streaming",
          toolCallId: "tool-call-1",
          type: "tool-bash",
        },
      ],
      role: "assistant",
    },
  ],
  title: "Debug session",
  updatedAt: new Date("2026-07-24T10:00:06.000Z"),
});

describe("session diagnostics", () => {
  it.each([
    ["Debug session", "Fix the modal", "# Debug session"],
    ["Untitled chat", "Fix the modal", "# Fix the modal"],
    ["Untitled chat 2", "Fix the modal", "# Fix the modal"],
    ["Untitled chat", undefined, "# Untitled chat"],
  ])(
    "heads a session titled %j in a task named %j with %j",
    async (title, taskName, heading) => {
      const markdown = await sessionToMarkdown(
        { ...session, title },
        { taskName },
      );
      expect(markdown.split("\n").find((line) => line.startsWith("# "))).toBe(
        heading,
      );
    },
  );

  it("includes persisted system context by default", async () => {
    const markdown = await sessionToMarkdown(session);
    expect(markdown).toContain("## Latest Persisted Context Snapshot");
    expect(markdown).toContain(
      "### System Context (task) @ 2026-07-24T10:00:01.000Z",
    );
    expect(markdown).toContain(
      "### Agent Context (task) @ 2026-07-24T10:00:01.000Z",
    );
    expect(markdown).toContain("```markdown\nPersisted system prompt\n```");
    expect(markdown).toContain("```markdown\nPersisted harness context\n```");
    expect(markdown).toContain("## User (Turn 1)");
    expect(markdown).toContain("## Assistant (User Turn 1, Step 2)");
    expect(markdown).not.toContain("## User (Turn 2)");

    const withoutContext = await sessionToMarkdown(session, {
      includeContextMessages: false,
    });
    expect(withoutContext).not.toContain("Persisted system prompt");
  });

  it("renders persisted sources, data parts, and interrupted tools", async () => {
    const markdown = await sessionToMarkdown(session);
    expect(markdown).toContain("### Sources");
    expect(markdown).toContain('"url": "https://provider.example/docs"');
    expect(markdown).toContain("### Persisted Data: skillChanges");
    expect(markdown).toContain('"pdf-report"');
    expect(markdown).toContain(
      "### Tool Call 1: bash *(incomplete: input-streaming)*",
    );
    expect(markdown).toContain('"rawInput": "{"');
  });

  // A user turn is the model's own message, XML wrapper and all, and a reader
  // that took the wrapper for markup would lose it. The wrapper and the words
  // reach the model as separate parts, and read as one fence.
  it("fences the user's turn as one block", async () => {
    const markdown = await sessionToMarkdown(session);
    const turn = /## User \(Turn 1\)[^\n]*\n\n([\s\S]*?)\n\n## /.exec(
      markdown,
    )?.[1];
    expect(turn).toMatchInlineSnapshot(`
      "\`\`\`markdown
      Human question
      <attached_folders>
      - one
      </attached_folders>
      \`\`\`"
    `);
  });

  it("keeps empty persisted assistant steps visible", async () => {
    const emptyAssistantSession = Session.WithMessagesAndPartsSchema.parse({
      ...session,
      messages: session.messages.map((message) =>
        message.role === "assistant"
          ? {
              ...message,
              parts: [
                ...message.parts.filter((part) => part.type === "step-start"),
                {
                  data: { maxStepCount: 100 },
                  metadata: {
                    createdAt: new Date("2026-07-24T10:00:05.000Z"),
                    id: maxStepsPartId,
                    messageId: assistantMessageId,
                    sessionId,
                  },
                  type: "data-maxSteps",
                },
              ],
            }
          : message,
      ),
    });

    const markdown = await sessionToMarkdown(emptyAssistantSession);
    expect(markdown).toContain("## Assistant (User Turn 1, Step 2)");
    expect(markdown).toContain(
      "> No model-visible assistant content was persisted for this step.",
    );
    expect(markdown).toContain("### Persisted Data: maxSteps");
    expect(markdown).toContain('"maxStepCount": 100');
  });

  it("summarizes persisted session metadata for front matter", () => {
    expect(buildSessionFrontMatter(session)).toMatchInlineSnapshot(`
      {
        "activeDurationMs": 2000,
        "aiGenerationDurationMs": 2000,
        "assistantMessageCount": 1,
        "messageCount": 4,
        "modelsUsed": [
          {
            "modelId": "debug-model",
            "providerId": "debug-provider",
          },
        ],
        "parentSessionId": undefined,
        "sessionCreatedAt": "2026-07-24T10:00:00.000Z",
        "sessionId": "ses_01J00000000000000000000000",
        "sessionTitle": "Debug session",
        "toolCallCount": 1,
        "usage": {
          "cacheReadTokens": 40,
          "cacheWriteTokens": 10,
          "inputTokens": 100,
          "outputTokens": 20,
          "reasoningTokens": 5,
          "totalTokens": 120,
        },
        "userMessageCount": 1,
      }
    `);
  });

  // A step run through a routing alias records `auto` as the model, so without
  // the served id the transcript cannot say what answered.
  it("names the served model when it differs from the requested one", () => {
    const assistantMessage = session.messages.find(
      (message) => message.role === "assistant",
    );
    const lines = renderAssistantMetadata({
      ...assistantMessage?.metadata,
      aiGatewayModel: createMockAIGatewayModel(),
      modelId: "auto",
      modelIdServed: "x-ai/grok-4.5",
    } as SessionMessage.Assistant["metadata"]);

    expect(lines[0]).toContain("model=auto");
    expect(lines[0]).toContain("served=x-ai/grok-4.5");
  });

  // The canonical id never equals a provider id for a provider that namespaces
  // by author, so comparing against it reported an alias on every message.
  it("omits the served model when it is the model that was requested", () => {
    const assistantMessage = session.messages.find(
      (message) => message.role === "assistant",
    );
    const aiGatewayModel = createMockAIGatewayModel();
    const lines = renderAssistantMetadata({
      ...assistantMessage?.metadata,
      aiGatewayModel,
      modelId: aiGatewayModel.canonicalId,
      modelIdServed: aiGatewayModel.providerId,
    } as SessionMessage.Assistant["metadata"]);

    expect(lines[0]).not.toContain("served=");
  });

  // A provider that resolves its own alias answers with the dated build behind
  // it, which is one model rather than two. Read here by the same rule as the
  // transcript, so an export and the app it came from cannot disagree about the
  // same message.
  it("omits the served model when the provider pinned the requested one to a build", () => {
    const assistantMessage = session.messages.find(
      (message) => message.role === "assistant",
    );
    const aiGatewayModel = createMockAIGatewayModel({
      providerId: "openai/gpt-5.6-luna",
    });
    const lines = renderAssistantMetadata({
      ...assistantMessage?.metadata,
      aiGatewayModel,
      modelId: aiGatewayModel.canonicalId,
      modelIdServed: "openai/gpt-5.6-luna-2026-01-15",
    } as SessionMessage.Assistant["metadata"]);

    expect(lines[0]).not.toContain("served=");
  });

  it("renders response-level model, usage, timing, and error metadata", () => {
    const assistantMessage = session.messages.find(
      (message) => message.role === "assistant",
    );
    expect(renderAssistantMetadata(assistantMessage?.metadata))
      .toMatchInlineSnapshot(`
        [
          "*Response metadata: provider=debug-provider, model=debug-model, finishReason=error, inputTokens=100, cacheReadTokens=40, cacheWriteTokens=10, noCacheTokens=50, outputTokens=20, reasoningTokens=5, textTokens=15, totalTokens=120, timeToFirstChunk=250ms, generationDuration=2.000s, completionTokensPerSecond=12.5*",
          "",
          "**Assistant error:**",
          "\`\`\`json
        {
          "kind": "api-call",
          "message": "Provider request failed",
          "name": "APIError",
          "statusCode": 500,
          "url": "https://provider.example/v1/responses"
        }
        \`\`\`",
          "",
        ]
      `);
  });
});

describe("renderToolInput", () => {
  // The bash command is where HTML most often turns up bare: a heredoc writing
  // a page, a Python string holding a tag. Fenced, `<a href=` is text.
  it("fences a multi-line command as bash and lists the short arguments", () => {
    expect(
      renderToolInput({
        command: "python3 - <<'PY'\nprint('<a href=')\nPY",
        explanation: "Checking the page",
        yieldMs: 30_000,
      }),
    ).toMatchInlineSnapshot(`
      [
        "- **explanation:** \`Checking the page\`",
        "- **yieldMs:** \`30000\`",
        "",
        "**command**",
        "",
        "\`\`\`bash
      python3 - <<'PY'
      print('<a href=')
      PY
      \`\`\`",
      ]
    `);
  });

  it("highlights file text as the file's own language", () => {
    expect(
      renderToolInput({
        filePath: "/mnt/Instrument/page.html",
        newString: '<footer class="source-footer">\n<strong>Sources.</strong>',
        oldString: "<footer>\n<strong>Sources.</strong>",
        replaceAll: false,
      }),
    ).toMatchInlineSnapshot(`
      [
        "- **filePath:** \`/mnt/Instrument/page.html\`",
        "- **replaceAll:** \`false\`",
        "",
        "**newString**",
        "",
        "\`\`\`html
      <footer class="source-footer">
      <strong>Sources.</strong>
      \`\`\`",
        "",
        "**oldString**",
        "",
        "\`\`\`html
      <footer>
      <strong>Sources.</strong>
      \`\`\`",
      ]
    `);
  });

  it("keeps a backtick-bearing value inside its code span", () => {
    expect(renderToolInput({ query: "what does `rg -l` do", title: "`x`" }))
      .toMatchInlineSnapshot(`
      [
        "- **query:** \`\`what does \`rg -l\` do\`\`",
        "- **title:** \`\` \`x\` \`\`",
      ]
    `);
  });

  it("renders objects inline when short and as json when not", () => {
    expect(
      renderToolInput({
        choices: Array.from({ length: 12 }, (_, i) => `choice number ${i}`),
        region: { x1: 0, x2: 0, y1: 0, y2: 0 },
      }),
    ).toMatchInlineSnapshot(`
      [
        "- **region:** \`{"x1":0,"x2":0,"y1":0,"y2":0}\`",
        "",
        "**choices**",
        "",
        "\`\`\`json
      [
        "choice number 0",
        "choice number 1",
        "choice number 2",
        "choice number 3",
        "choice number 4",
        "choice number 5",
        "choice number 6",
        "choice number 7",
        "choice number 8",
        "choice number 9",
        "choice number 10",
        "choice number 11"
      ]
      \`\`\`",
      ]
    `);
  });

  it("shows the raw text of a call that never finished arriving", () => {
    expect(renderToolInput('{"command": "ls')).toMatchInlineSnapshot(`
      [
        "\`\`\`json
      {"command": "ls
      \`\`\`",
      ]
    `);
    expect(renderToolInput({})).toEqual(["*(no arguments)*"]);
  });
});

describe("renderToolOutput", () => {
  it("fences an error's text", () => {
    expect(
      renderToolOutput({ type: "error-text", value: "# not a heading\n<b>" }),
    ).toMatchInlineSnapshot(`
      [
        "**Error:**",
        "\`\`\`text
      # not a heading
      <b>
      \`\`\`",
      ]
    `);
  });

  it("records content text and media metadata without exporting media bytes", () => {
    expect(
      renderToolOutput({
        type: "content",
        value: [
          {
            text: "Image file: work/pdf-preview/page-001.png.",
            type: "text",
          },
          {
            data: "base64-image-data",
            mediaType: "image/png",
            type: "media",
          },
        ],
      }),
    ).toMatchInlineSnapshot(`
      [
        "\`\`\`markdown
      Image file: work/pdf-preview/page-001.png.
      \`\`\`",
        "*[1 media attachment omitted from transcript: image/png]*",
      ]
    `);
  });
});
