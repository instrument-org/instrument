import type { ModelMessage } from "ai";

import { subMinutes } from "date-fns";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { SessionMessage } from "../schemas/session/message";

import { type AnyAgent } from "../agents/types";
import { RelativePathSchema } from "../schemas/paths";
import { SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { prepareModelMessages } from "./prepare-model-messages";
import { Store } from "./store";

vi.mock(import("./session-store-storage"));

// Half of an emoji: the code unit left behind when text is cut mid-character.
// A provider handed one rejects the whole request, so nothing may carry it out.
const LONE_SURROGATE = "\u{D83D}";

const anthropicModel = createMockAIGatewayModel({ author: "anthropic" });

/** Every text a request carries, whichever role and shape holds it. */
function modelTexts(messages: ModelMessage[]) {
  return messages.flatMap((message) =>
    typeof message.content === "string"
      ? [message.content]
      : message.content.flatMap((part) => {
          if (part.type === "text") {
            return [part.text];
          }
          if (part.type === "tool-result" && part.output.type === "text") {
            return [part.output.value];
          }
          return [];
        }),
  );
}

/** A tool call id holding what Anthropic's id pattern refuses. */
const HOSTILE_TOOL_CALL_ID = StoreId.ToolCallSchema.parse("call/01:abc.def");

describe("prepareModelMessages", () => {
  let sessionId: StoreId.Session;
  let taskId: ReturnType<typeof TaskIdSchema.parse>;
  let contextMessages: SessionMessage.ContextWithParts[];
  let getMessages: Mock<AnyAgent["getMessages"]>;
  let agent: AnyAgent;

  function partMetadata(messageId: StoreId.Message, createdAt = new Date()) {
    return {
      createdAt,
      id: StoreId.newPartId(),
      messageId,
      sessionId,
    };
  }

  function contextMessage(
    createdAt: Date,
    text: string,
    realRole: "system" | "user" = "system",
  ): SessionMessage.ContextWithParts {
    const id = StoreId.newMessageId();
    return {
      id,
      metadata: {
        agentName: "main",
        createdAt,
        realRole,
        sessionId,
      },
      parts: [{ metadata: partMetadata(id, createdAt), text, type: "text" }],
      role: "session-context",
    };
  }

  /** A user turn holding text plus a media file, both hostile. */
  function userMessage(text: string): SessionMessage.UserWithParts {
    const id = StoreId.newMessageId();
    return {
      id,
      metadata: { createdAt: new Date(), sessionId },
      parts: [
        { metadata: partMetadata(id), state: "done", text, type: "text" },
        {
          mediaType: "audio/mp3",
          metadata: partMetadata(id),
          type: "file",
          url: "data:audio/mp3;base64,QUJD",
        },
      ],
      role: "user",
    };
  }

  function assistantMessage(text: string): SessionMessage.AssistantWithParts {
    const id = StoreId.newMessageId();
    return {
      id,
      metadata: {
        createdAt: new Date(),
        finishReason: "stop",
        modelId: "mock-model-id",
        providerId: "mock-provider-id",
        sessionId,
      },
      parts: [
        { metadata: partMetadata(id), state: "done", text, type: "text" },
      ],
      role: "assistant",
    };
  }

  /** An assistant turn whose tool call carries an id and output of our choosing. */
  function toolCallMessage(output: string): SessionMessage.AssistantWithParts {
    const id = StoreId.newMessageId();
    return {
      id,
      metadata: {
        createdAt: new Date(),
        finishReason: "tool-calls",
        modelId: "mock-model-id",
        providerId: "mock-provider-id",
        sessionId,
      },
      parts: [
        SessionMessagePart.coerce({
          input: { filePath: "./notes.txt" },
          metadata: { ...partMetadata(id), endedAt: new Date() },
          output: {
            content: output,
            displayedLines: 1,
            filePath: RelativePathSchema.parse("./notes.txt"),
            hasMoreLines: false,
            modifiedAt: 1_234_567_890,
            offset: 1,
            state: "exists",
            totalLines: 1,
            truncatedByBytes: false,
          },
          state: "output-available",
          toolCallId: HOSTILE_TOOL_CALL_ID,
          type: "tool-read_file",
        }),
      ],
      role: "assistant",
    };
  }

  /** An assistant turn that recorded nothing but a failure. */
  function failedMessage(): SessionMessage.AssistantWithParts {
    const id = StoreId.newMessageId();
    return {
      id,
      metadata: {
        createdAt: new Date(),
        error: {
          kind: "api-call",
          message: "Overloaded",
          name: "AI_APICallError",
          url: "https://example.com",
        },
        finishReason: "unknown",
        modelId: "mock-model-id",
        providerId: "mock-provider-id",
        sessionId,
      },
      parts: [
        {
          metadata: partMetadata(id),
          state: "done",
          text: "half a sen",
          type: "text",
        },
      ],
      role: "assistant",
    };
  }

  /**
   * A turn holding nothing a model message can carry, which is what a message
   * stored before its parts were written leaves behind. It converts to content
   * of length zero, and a provider refuses a message with no content at all.
   */
  function contentlessMessage(): SessionMessage.UserWithParts {
    return {
      id: StoreId.newMessageId(),
      metadata: { createdAt: new Date(), sessionId },
      parts: [],
      role: "user",
    };
  }

  /** Store a message, failing the test loudly if the store refuses it. */
  async function save(message: SessionMessage.WithParts) {
    const result = await Store.saveMessageWithParts(message, taskId);
    result._unsafeUnwrap();
  }

  async function prepare(model = anthropicModel) {
    const result = await prepareModelMessages({
      agent,
      model,
      sessionId,
      signal: AbortSignal.timeout(30_000),
      taskId,
    });
    return result._unsafeUnwrap();
  }

  beforeEach(async () => {
    sessionId = StoreId.newSessionId();
    taskId = createMockTaskConfig(TaskIdSchema.parse("mock"), {
      model: anthropicModel,
    });
    contextMessages = [contextMessage(new Date(), "You are a helpful agent.")];
    getMessages = vi.fn<AnyAgent["getMessages"]>(() =>
      Promise.resolve(contextMessages),
    );
    agent = {
      agentTools: {},
      getMessages,
      getTools: () => Promise.resolve([]),
      name: "main",
      onFinish: () => Promise.resolve(),
      onStart: () => Promise.resolve(),
      shouldContinue: () => Promise.resolve(true),
    };
    await Store.saveSession(
      { createdAt: new Date(), id: sessionId, title: "Test session" },
      taskId,
    );
  });

  describe("invariants a request cannot go out without", () => {
    beforeEach(async () => {
      // A conversation carrying everything the passes disagree about: a tool
      // call id Anthropic refuses, a lone surrogate in the user's text and in
      // what the tool read back, media this model cannot accept, and a turn
      // holding no model-visible content at all.
      for (const message of [
        userMessage(`Read my notes ${LONE_SURROGATE}please`),
        toolCallMessage(`line one ${LONE_SURROGATE}`),
        contentlessMessage(),
      ]) {
        await save(message);
      }
    });

    it("keeps every tool call paired with its result", async () => {
      const messages = await prepare();

      const callIds = new Set<string>();
      const resultIds = new Set<string>();
      for (const message of messages) {
        if (typeof message.content === "string") {
          continue;
        }
        for (const part of message.content) {
          if (part.type === "tool-call") {
            callIds.add(part.toolCallId);
          }
          if (part.type === "tool-result") {
            resultIds.add(part.toolCallId);
          }
        }
      }

      expect(resultIds.size).toBeGreaterThan(0);
      expect([...resultIds].sort()).toEqual([...callIds].sort());
      // Normalized on the way out, since the stored id is not one Anthropic takes.
      expect([...callIds]).toMatchInlineSnapshot(`
        [
          "call_01_abc_def",
        ]
      `);
    });

    it("sends no message with empty content", async () => {
      const messages = await prepare();

      expect(messages.length).toBeGreaterThan(0);
      for (const message of messages) {
        expect(message.content.length).toBeGreaterThan(0);
      }
    });

    it("strips lone surrogates from every text it carries", async () => {
      // Read the strings themselves rather than a serialization of them:
      // `JSON.stringify` escapes a lone surrogate to `\uXXXX`, so a search of
      // its output would come back clean whether or not the half was removed.
      const texts = modelTexts(await prepare());

      expect(texts.filter((text) => text.includes(LONE_SURROGATE))).toEqual([]);
      // The words around the removed half close up, which is what proves the
      // pass ran at all: unsanitized, the half still sits between them.
      expect(texts).toContain("Read my notes please");
      expect(texts.join("\n")).toContain("line one");
    });

    it("replaces media the model cannot read with a note saying so", async () => {
      const messages = await prepare();

      expect(modelTexts(messages).join("\n")).toContain(
        "Audio file removed - your model lacks audio input capability.",
      );
      // Nothing is silently gone: no audio slot is left behind either.
      expect(JSON.stringify(messages)).not.toContain("audio/mp3");
    });

    it("leaves a non-Anthropic model's ids and breakpoints untouched", async () => {
      const messages = await prepare(createMockAIGatewayModel());

      expect(JSON.stringify(messages)).toContain(HOSTILE_TOOL_CALL_ID);
      for (const message of messages) {
        expect(message.providerOptions?.anthropic).toBeUndefined();
      }
    });
  });

  describe("cache breakpoints", () => {
    it("places at most four over a long conversation", async () => {
      // Anthropic accepts four `cache_control` blocks per request and rejects
      // the request outright on the fifth, so the ceiling has to hold however
      // long the conversation gets.
      for (let turn = 0; turn < 6; turn++) {
        await save(userMessage(`turn ${turn}`));
        await save(assistantMessage(`reply ${turn}`));
      }

      const messages = await prepare();

      let breakpoints = 0;
      for (const message of messages) {
        if (message.providerOptions?.anthropic?.cacheControl) {
          breakpoints++;
        }
        if (typeof message.content === "string") {
          continue;
        }
        for (const part of message.content) {
          if (
            "providerOptions" in part &&
            part.providerOptions?.anthropic?.cacheControl
          ) {
            breakpoints++;
          }
        }
      }

      expect(messages.length).toBeGreaterThan(10);
      expect(breakpoints).toBeGreaterThan(0);
      expect(breakpoints).toBeLessThanOrEqual(4);
    });
  });

  describe("ordering", () => {
    it("puts the context message first and keeps the turns in order", async () => {
      for (const message of [
        userMessage("first"),
        toolCallMessage("read"),
        userMessage("second"),
      ]) {
        await save(message);
      }

      const messages = await prepare();

      expect(messages.map((message) => message.role)).toMatchInlineSnapshot(`
        [
          "system",
          "user",
          "assistant",
          "tool",
          "user",
        ]
      `);
      const userTexts = messages.flatMap((message) =>
        message.role === "user" && Array.isArray(message.content)
          ? message.content.flatMap((part) =>
              part.type === "text" ? [part.text] : [],
            )
          : [],
      );
      expect(
        userTexts.filter((text) => !text.startsWith("<system_note>")),
      ).toEqual(["first", "second"]);
    });

    it("hoists the system prompt over a context message minted before it", async () => {
      // An agent contributes more than one context message, and they go out in
      // ulid order, which is the order they were built in. Build the user-role
      // one first and the system prompt is no longer first by position, which
      // some providers refuse outright.
      const now = new Date();
      contextMessages = [
        contextMessage(now, "The task layout.", "user"),
        contextMessage(now, "You are a helpful agent."),
      ];
      await save(userMessage("first"));

      const messages = await prepare();

      expect(messages.map((message) => message.role)).toMatchInlineSnapshot(`
        [
          "system",
          "user",
          "user",
        ]
      `);
      expect(messages[0]?.content).toBe("You are a helpful agent.");
    });
  });

  describe("trailing failures", () => {
    it("drops a failed tail and keeps the history it followed", async () => {
      for (const message of [
        userMessage("do something"),
        toolCallMessage("read"),
        failedMessage(),
      ]) {
        await save(message);
      }

      const messages = await prepare();

      expect(JSON.stringify(messages)).not.toContain("half a sen");
      expect(messages.map((message) => message.role)).toMatchInlineSnapshot(`
        [
          "system",
          "user",
          "assistant",
          "tool",
        ]
      `);
    });
  });

  describe("session context", () => {
    it("reuses a fresh context message instead of rebuilding it", async () => {
      const stored = contextMessage(new Date(), "The standing instructions.");
      await save(stored);

      const messages = await prepare();

      expect(getMessages).not.toHaveBeenCalled();
      expect(messages[0]).toEqual({
        content: "The standing instructions.",
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
          bedrock: { cachePoint: { type: "ephemeral" } },
          openaiCompatible: { cache_control: { type: "ephemeral" } },
          openrouter: { cache_control: { type: "ephemeral" } },
        },
        role: "system",
      });
    });

    it("rebuilds a stale context message and removes the old one", async () => {
      const stale = contextMessage(
        subMinutes(new Date(), 61),
        "The stale instructions.",
      );
      await save(stale);
      contextMessages = [contextMessage(new Date(), "The fresh instructions.")];

      const messages = await prepare();

      expect(getMessages).toHaveBeenCalledOnce();
      expect(JSON.stringify(messages)).not.toContain("The stale instructions.");
      expect(JSON.stringify(messages)).toContain("The fresh instructions.");
      // Rebuilt on disk too, or the next turn pays for it again.
      const storedResult = await Store.getMessagesWithParts({
        sessionId,
        taskId,
      });
      const stored = storedResult._unsafeUnwrap();
      expect(stored.map((message) => message.id)).not.toContain(stale.id);
      expect(stored).toHaveLength(1);
    });
  });
});
