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

  /**
   * An assistant turn reporting the input tokens the provider counted for it.
   *
   * `inputTokens` is the whole of what occupied the window, cache reads
   * included, which is what the budget reads and why nothing here adds the
   * cache fields on top of it.
   */
  function assistantMessageWithUsage(
    text: string,
    inputTokens: number,
  ): SessionMessage.AssistantWithParts {
    const message = assistantMessage(text);
    return {
      ...message,
      metadata: {
        ...message.metadata,
        usage: {
          inputTokenDetails: {
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            noCacheTokens: inputTokens,
          },
          inputTokens,
          outputTokenDetails: { reasoningTokens: 0, textTokens: 0 },
          outputTokens: 0,
          totalTokens: inputTokens,
        },
      },
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
    it("reuses a stored context message instead of rebuilding it", async () => {
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

    it("keeps a baseline older than the former staleness threshold", async () => {
      const stored = contextMessage(
        subMinutes(new Date(), 61),
        "The standing instructions.",
      );
      await save(stored);
      contextMessages = [contextMessage(new Date(), "The rebuilt instructions.")];

      const messages = await prepare();

      // Age is not a reason to rewrite it. Replacing the message would move the
      // front of every later request, which is the prefix a provider cache is
      // keyed on, to restate facts that mostly did not change.
      expect(getMessages).not.toHaveBeenCalled();
      expect(JSON.stringify(messages)).toContain("The standing instructions.");
      expect(JSON.stringify(messages)).not.toContain(
        "The rebuilt instructions.",
      );
      const storedResult = await Store.getMessagesWithParts({
        sessionId,
        taskId,
      });
      expect(
        storedResult._unsafeUnwrap().map((message) => message.id),
      ).toEqual([stored.id]);
    });

    it("builds the baseline once and never rewrites it as history grows", async () => {
      let build = 0;
      getMessages.mockImplementation(() =>
        Promise.resolve([
          contextMessage(new Date(), `The standing instructions, build ${++build}.`),
        ]),
      );

      await save(userMessage("first"));
      const first = await prepare();
      await save(assistantMessage("Done."));
      const second = await prepare();

      expect(getMessages).toHaveBeenCalledOnce();
      expect(second[0]?.content).toEqual(first[0]?.content);
      expect(JSON.stringify(second)).not.toContain("build 2");
    });

    it("reconstructs an unchanged session identically", async () => {
      await save(userMessage("first"));
      await save(assistantMessage("Done."));

      // Nothing in the assembly reads a clock or rescans the machine, so a
      // request rebuilt from the same stored session is the same bytes.
      expect(await prepare()).toEqual(await prepare());
    });
  });

  describe("context budget", () => {
    // 1,000 tokens of window: the reserve caps at a fifth of it, leaving 800
    // usable, so warn lands at 680 and exhausted at 800. Small enough that a
    // three-message conversation reaches either.
    const smallWindowModel = createMockAIGatewayModel({ contextLength: 1000 });

    /** The boundary the session records, or undefined if it has never reset. */
    async function storedBoundary() {
      const result = await Store.getSession(sessionId, taskId);
      return result._unsafeUnwrap().rolledOverAfterMessageId;
    }

    async function storedRolloverParts() {
      const result = await Store.getMessagesWithParts({ sessionId, taskId });
      return result
        ._unsafeUnwrap()
        .flatMap((message) => message.parts)
        .filter((part) => part.type === "data-contextRollover");
    }

    /** The notice, if this request carries one. */
    function noticeIn(messages: ModelMessage[]) {
      return modelTexts(messages).find((text) =>
        text.includes("<context-budget>"),
      );
    }

    describe("a model whose window is unknown", () => {
      it("produces no warning and no rollover, however full it is", async () => {
        await save(userMessage("First question"));
        for (const text of ["one", "two", "three", "four"]) {
          await save(assistantMessageWithUsage(text, 10_000_000));
        }

        const messages = await prepare(anthropicModel);

        expect(noticeIn(messages)).toBeUndefined();
        expect(await storedBoundary()).toBeUndefined();
      });

      it("assembles the same request whether occupancy is huge or tiny", async () => {
        await save(userMessage("First question"));
        await save(assistantMessageWithUsage("tiny", 1));
        const withTinyUsage = await prepare(anthropicModel);

        // A second session identical but for the number the provider reported.
        sessionId = StoreId.newSessionId();
        await Store.saveSession(
          { createdAt: new Date(), id: sessionId, title: "Test session" },
          taskId,
        );
        await save(userMessage("First question"));
        await save(assistantMessageWithUsage("tiny", 10_000_000));
        const withHugeUsage = await prepare(anthropicModel);

        expect(modelTexts(withHugeUsage)).toStrictEqual(
          modelTexts(withTinyUsage),
        );
      });
    });

    describe("a model whose window is known", () => {
      it("says nothing while there is room", async () => {
        await save(userMessage("First question"));
        await save(assistantMessageWithUsage("plenty of room", 100));

        expect(noticeIn(await prepare(smallWindowModel))).toBeUndefined();
      });

      it("warns once past the threshold, without rewriting history", async () => {
        await save(userMessage("First question"));
        await save(assistantMessageWithUsage("getting full", 700));

        const messages = await prepare(smallWindowModel);

        expect(noticeIn(messages)).toContain("tokens of context remain");
        expect(await storedBoundary()).toBeUndefined();
      });

      it("puts the notice last, behind every cache breakpoint", async () => {
        await save(userMessage("First question"));
        await save(assistantMessageWithUsage("getting full", 700));

        const messages = await prepare(smallWindowModel);

        const last = messages.at(-1);
        expect(last?.role).toBe("user");
        expect(JSON.stringify(last?.content)).toContain("<context-budget>");
      });

      it("never persists the notice", async () => {
        await save(userMessage("First question"));
        await save(assistantMessageWithUsage("getting full", 700));

        await prepare(smallWindowModel);

        const stored = await Store.getMessagesWithParts({ sessionId, taskId });
        expect(JSON.stringify(stored._unsafeUnwrap())).not.toContain(
          "<context-budget>",
        );
      });
    });

    describe("rollover", () => {
      /** A conversation over the usable window, with `turns` model turns in it. */
      async function fillPast(turns: number) {
        await save(userMessage("First question"));
        for (let index = 0; index < turns; index++) {
          await save(assistantMessageWithUsage(`turn ${index}`, 900));
        }
      }

      it("does not fire when there are too few model turns to reclaim", async () => {
        await fillPast(3);

        const messages = await prepare(smallWindowModel);

        // Exhausted, so it still says so; it just has nothing to free.
        expect(noticeIn(messages)).toContain("used all");
        expect(await storedBoundary()).toBeUndefined();
      });

      it("records the boundary on the newest message once it can reclaim", async () => {
        await fillPast(4);
        const before = await Store.getMessagesWithParts({ sessionId, taskId });
        const newestId = before._unsafeUnwrap().at(-1)?.id;

        await prepare(smallWindowModel);

        expect(await storedBoundary()).toBe(newestId);
      });

      it("stops sending the model's half and keeps the user's", async () => {
        await fillPast(4);

        const messages = await prepare(smallWindowModel);
        const texts = modelTexts(messages);

        expect(texts.some((text) => text.includes("First question"))).toBe(
          true,
        );
        expect(texts.some((text) => text.includes("turn 0"))).toBe(false);
      });

      it("deletes nothing from disk", async () => {
        await fillPast(4);

        // Context messages are written by the first assembly, so what this
        // compares is the conversation, which a rollover must leave alone.
        async function conversationIds() {
          const result = await Store.getMessagesWithParts({
            sessionId,
            taskId,
          });
          return result
            ._unsafeUnwrap()
            .filter((message) => message.role !== "session-context")
            .map((message) => message.id);
        }

        const before = await conversationIds();

        await prepare(smallWindowModel);

        expect(await conversationIds()).toStrictEqual(before);
      });

      it("marks the transcript where the boundary landed", async () => {
        await fillPast(4);

        await prepare(smallWindowModel);

        const rolloverParts = await storedRolloverParts();
        const boundary = await storedBoundary();
        expect(rolloverParts).toHaveLength(1);
        expect(rolloverParts[0]?.metadata.messageId).toBe(boundary);
      });

      it("marks it once, not again on every later turn", async () => {
        await fillPast(4);

        await prepare(smallWindowModel);
        await prepare(smallWindowModel);

        expect(await storedRolloverParts()).toHaveLength(1);
      });
    });
  });
});
