import type { ModelMessage } from "ai";

import { subMinutes } from "date-fns";
import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { SessionMessage } from "../schemas/session/message";

import { type AnyAgent } from "../agents/types";
import { RelativePathSchema } from "../schemas/paths";
import { SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { ChatIdSchema } from "../schemas/chat-id";
import { noteReportedContextLength } from "@instrument-org/ai-gateway/context-windows";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { ChatReads } from "./chat-reads";
import { ChatWrites } from "./chat-writes";
import { prepareModelMessages } from "./prepare-model-messages";
import { SESSION_CONTEXT_VERSION } from "./session-baseline";
import { chatDir } from "./record-folders";
import { shellPath } from "./workspace-fs-layout";

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
  let chatId: ReturnType<typeof ChatIdSchema.parse>;
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
        contextVersion: SESSION_CONTEXT_VERSION,
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
    const result = await ChatWrites.saveMessageWithParts(message, chatId);
    result._unsafeUnwrap();
  }

  async function prepare(model = anthropicModel) {
    const result = await prepareModelMessages({
      agent,
      model,
      sessionId,
      signal: AbortSignal.timeout(30_000),
      chatId,
    });
    return result._unsafeUnwrap();
  }

  beforeEach(async () => {
    sessionId = StoreId.newSessionId();
    chatId = createMockChatConfig(ChatIdSchema.parse("mock"), {
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
      name: "instrument",
      onFinish: () => Promise.resolve(),
      onStart: () => Promise.resolve(),
      shouldContinue: () => Promise.resolve(true),
      // The prompt of whatever baseline this build would write now.
      systemPrompt: () =>
        contextMessages
          .filter((message) => message.metadata.realRole === "system")
          .flatMap((message) => message.parts)
          .map((part) => (part.type === "text" ? part.text : ""))
          .join(""),
    };
    await ChatWrites.saveSession(
      { createdAt: new Date(), id: sessionId, title: "Test session" },
      chatId,
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

    it("leaves a failed half out once its retry finished, and keeps it stored", async () => {
      await save(userMessage("do something"));
      await save(failedMessage());
      const retry = assistantMessage("the whole answer");
      await save({
        ...retry,
        metadata: { ...retry.metadata, finishedAt: new Date() },
      });
      await save(userMessage("and then"));

      const messages = await prepare();

      expect(JSON.stringify(messages)).not.toContain("half a sen");
      expect(messages.map((message) => message.role)).toMatchInlineSnapshot(`
        [
          "system",
          "user",
          "assistant",
          "user",
        ]
      `);
      const stored = await ChatReads.transcript({ chatId, sessionId });
      expect(JSON.stringify(stored._unsafeUnwrap())).toContain("half a sen");
    });
  });

  describe("session context", () => {
    it("reuses a stored context message instead of rebuilding it", async () => {
      const stored = contextMessage(new Date(), "You are a helpful agent.");
      await save(stored);

      const messages = await prepare();

      expect(getMessages).not.toHaveBeenCalled();
      expect(messages[0]).toEqual({
        content: "You are a helpful agent.",
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
          bedrock: { cachePoint: { type: "ephemeral" } },
          openaiCompatible: { cache_control: { type: "ephemeral" } },
        },
        role: "system",
      });
    });

    it("keeps a baseline older than the former staleness threshold", async () => {
      const stored = contextMessage(
        subMinutes(new Date(), 61),
        "The standing instructions.",
        "user",
      );
      await save(stored);
      contextMessages = [
        ...contextMessages,
        contextMessage(new Date(), "The rebuilt instructions.", "user"),
      ];

      const messages = await prepare();

      // Age is not a reason to rewrite it. Replacing the message would move the
      // front of every later request, which is the prefix a provider cache is
      // keyed on, to restate facts that mostly did not change.
      expect(getMessages).not.toHaveBeenCalled();
      expect(JSON.stringify(messages)).toContain("The standing instructions.");
      expect(JSON.stringify(messages)).not.toContain(
        "The rebuilt instructions.",
      );
      const storedResult = await ChatReads.transcript({
        sessionId,
        chatId,
      });
      expect(storedResult._unsafeUnwrap().map((message) => message.id)).toEqual(
        [stored.id],
      );
    });

    it("builds the baseline once and never rewrites it as history grows", async () => {
      let build = 0;
      getMessages.mockImplementation(() =>
        Promise.resolve([
          ...contextMessages,
          contextMessage(
            new Date(),
            `The standing context, build ${++build}.`,
            "user",
          ),
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

    it("rebuilds a baseline written before the marker existed, once", async () => {
      // What a release that predates the marker left behind. Nothing in it says
      // which shape it holds, so the only safe reading is that it predates
      // whatever this build puts in a baseline.
      const stored = contextMessage(
        new Date(),
        "The instructions the old release wrote.",
      );
      const { contextVersion: _contextVersion, ...metadata } = stored.metadata;
      await save({ ...stored, metadata });
      contextMessages = [
        contextMessage(new Date(), "The instructions this release writes."),
      ];

      const first = await prepare();

      expect(getMessages).toHaveBeenCalledOnce();
      expect(JSON.stringify(first)).toContain(
        "The instructions this release writes.",
      );
      expect(JSON.stringify(first)).not.toContain(
        "The instructions the old release wrote.",
      );
      // Replaced, not added to: the superseded baseline left in the store would
      // be sent alongside the new one for the rest of the session.
      const storedResult = await ChatReads.transcript({
        sessionId,
        chatId,
      });
      expect(storedResult._unsafeUnwrap().map((message) => message.id)).toEqual(
        contextMessages.map((message) => message.id),
      );

      const second = await prepare();

      // Marked on the way in, so the next turn reuses it like any other and the
      // request prefix moves once rather than on every turn from here on.
      expect(getMessages).toHaveBeenCalledOnce();
      expect(second).toEqual(first);
    });

    it("rebuilds a baseline marked with a shape older than this build's", async () => {
      const stored = contextMessage(
        new Date(),
        "The instructions the old release wrote.",
      );
      await save({
        ...stored,
        metadata: {
          ...stored.metadata,
          contextVersion: SESSION_CONTEXT_VERSION - 1,
        },
      });
      contextMessages = [
        contextMessage(new Date(), "The instructions this release writes."),
      ];

      const messages = await prepare();

      expect(getMessages).toHaveBeenCalledOnce();
      expect(JSON.stringify(messages)).toContain(
        "The instructions this release writes.",
      );
      expect(JSON.stringify(messages)).not.toContain(
        "The instructions the old release wrote.",
      );
    });

    it("leaves a task's inherited baseline to its chat when rebuilding", async () => {
      const chatSessionId = sessionId;
      const inherited = contextMessage(
        new Date(),
        "The prompt the previous build wrote.",
      );
      await save({
        ...inherited,
        metadata: {
          ...inherited.metadata,
          contextVersion: SESSION_CONTEXT_VERSION - 1,
        },
      });
      const forkedAt = userMessage("Look into it in the background.");
      await save(forkedAt);
      sessionId = StoreId.newSessionId();
      await ChatWrites.saveSession(
        {
          createdAt: new Date(),
          forkedAtMessageId: forkedAt.id,
          id: sessionId,
          parentId: chatSessionId,
          title: "Task",
        },
        chatId,
      );
      contextMessages = [
        contextMessage(new Date(), "The prompt this build writes."),
      ];

      const messages = await prepare();

      expect(JSON.stringify(messages)).toContain(
        "The prompt this build writes.",
      );
      expect(JSON.stringify(messages)).not.toContain(
        "The prompt the previous build wrote.",
      );
      const chatOwn = await ChatReads.transcript({
        chatId,
        inherited: false,
        sessionId: chatSessionId,
      });
      expect(
        chatOwn
          ._unsafeUnwrap()
          .filter((message) => message.role === "session-context"),
      ).toHaveLength(1);
    });

    it("keeps a baseline whose system prompt this build no longer writes", async () => {
      // What an app update and a chat moving to another computer both look
      // like. The new prompt reaches the chat at its next rollover.
      await save(
        contextMessage(new Date(), "The prompt the previous build wrote."),
      );
      contextMessages = [
        contextMessage(new Date(), "The prompt this build writes."),
      ];

      const request = JSON.stringify(await prepare());

      expect(getMessages).not.toHaveBeenCalled();
      expect(request).toContain("The prompt the previous build wrote.");
      expect(request).not.toContain("The prompt this build writes.");
    });

    it("starts each request with the whole of the one before it", async () => {
      await save(userMessage("first"));
      const first = await prepare();
      // An app update rewrites the prompt this build would write, and the
      // computer changes under the chat: neither touches what was sent.
      contextMessages = [
        contextMessage(new Date(), "The prompt a later build writes."),
      ];
      await save(assistantMessage("Done."));
      const moved = userMessage("and now?");
      await save({
        ...moved,
        parts: [
          ...moved.parts,
          {
            data: { computer: "Windows (win32 10.0.26200)", platform: "win32" },
            metadata: partMetadata(moved.id),
            type: "data-environmentChange",
          },
        ],
      });

      const second = await prepare();

      // The last messages of the first request carried its cache breakpoints,
      // which the second places on its own last messages instead. A marker is
      // not part of the bytes a cache matches, so it is left out here.
      const withoutBreakpoints = (messages: ModelMessage[]): unknown =>
        JSON.parse(
          JSON.stringify(messages, (key, value: unknown) =>
            key === "providerOptions" ? undefined : value,
          ),
        );
      expect(withoutBreakpoints(second.slice(0, first.length - 1))).toEqual(
        withoutBreakpoints(first.slice(0, first.length - 1)),
      );
      expect(JSON.stringify(second.at(-1))).toContain(
        "Windows (win32 10.0.26200)",
      );
    });

    it("writes the baseline again when the window rolls over past it", async () => {
      const smallWindowModel = createMockAIGatewayModel({
        contextLength: 1000,
      });
      await save(userMessage("First question"));
      await prepare(smallWindowModel);
      for (let index = 0; index < 4; index++) {
        await save(assistantMessageWithUsage(`turn ${index}`, 900));
      }
      // Minted now, as a build writing it would: after the turns it follows.
      contextMessages = [
        contextMessage(new Date(), "The prompt a later build writes."),
      ];

      const rolledOver = JSON.stringify(await prepare(smallWindowModel));

      expect(getMessages).toHaveBeenCalledTimes(2);
      expect(rolledOver).toContain("The prompt a later build writes.");
      expect(rolledOver).not.toContain("You are a helpful agent.");

      await save(userMessage("Next question"));
      await prepare(smallWindowModel);

      // Written once for the rollover, then read back like any other.
      expect(getMessages).toHaveBeenCalledTimes(2);
    });

    it("sends a task's own baseline rather than the one it inherited", async () => {
      const chatSessionId = sessionId;
      await save(contextMessage(new Date(), "The chat's prompt."));
      const forkedAt = userMessage("Look into it in the background.");
      await save(forkedAt);
      sessionId = StoreId.newSessionId();
      await ChatWrites.saveSession(
        {
          createdAt: new Date(),
          forkedAtMessageId: forkedAt.id,
          id: sessionId,
          parentId: chatSessionId,
          title: "Task",
        },
        chatId,
      );
      await save(contextMessage(new Date(), "The task's own prompt."));

      const request = JSON.stringify(await prepare());

      expect(getMessages).not.toHaveBeenCalled();
      expect(request).toContain("The task's own prompt.");
      expect(request).not.toContain("The chat's prompt.");
    });

    it("keeps a baseline whose context message differs but whose prompt is current", async () => {
      // The context message carries the task's own facts (date, folders), which
      // differ from a fresh build's by design; only the prompt says which build
      // wrote the baseline.
      await save(contextMessage(new Date(), "You are a helpful agent."));
      await save(
        contextMessage(new Date(), "The folders when it started.", "user"),
      );

      const messages = await prepare();

      expect(getMessages).not.toHaveBeenCalled();
      expect(JSON.stringify(messages)).toContain(
        "The folders when it started.",
      );
    });

    it("keeps a baseline marked with a shape newer than this build's", async () => {
      const stored = contextMessage(
        new Date(),
        "The instructions a later release wrote.",
      );
      await save({
        ...stored,
        metadata: {
          ...stored.metadata,
          contextVersion: SESSION_CONTEXT_VERSION + 1,
        },
      });

      const messages = await prepare();

      // An older build running against a newer baseline has nothing better to
      // put there, and rewriting it would undo the upgrade on every downgrade.
      expect(getMessages).not.toHaveBeenCalled();
      expect(JSON.stringify(messages)).toContain(
        "The instructions a later release wrote.",
      );
    });
  });

  describe("context budget", () => {
    // 1,000 tokens of window: the reserve caps at a fifth of it, leaving 800
    // usable, so warn lands at 680 and exhausted at 800. Small enough that a
    // three-message conversation reaches either.
    const smallWindowModel = createMockAIGatewayModel({ contextLength: 1000 });

    /** The boundary the session records, or undefined if it has never reset. */
    beforeEach(async () => {
      await fs.rm(path.join(chatDir(chatId), "handoff-notes.md"), {
        force: true,
      });
    });

    async function storedBoundary() {
      const result = await ChatReads.session({ chatId, sessionId });
      return result._unsafeUnwrap().rolledOverAfterMessageId;
    }

    async function storedRolloverParts() {
      const result = await ChatReads.transcript({ sessionId, chatId });
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

    /** A turn the provider refused for size, which reports no usage at all. */
    function refusedForSize(): SessionMessage.AssistantWithParts {
      const message = assistantMessage("");
      return {
        ...message,
        metadata: {
          ...message.metadata,
          error: {
            classification: "context-overflow",
            kind: "api-call",
            message: "prompt is too long",
            name: "AI_APICallError",
            url: "https://example.test/v1/messages",
          },
          finishReason: "error",
        },
      };
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
        await ChatWrites.saveSession(
          { createdAt: new Date(), id: sessionId, title: "Test session" },
          chatId,
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

        const stored = await ChatReads.transcript({ sessionId, chatId });
        expect(JSON.stringify(stored._unsafeUnwrap())).not.toContain(
          "<context-budget>",
        );
      });
    });

    describe("a model whose provider reported its window", () => {
      // A Claude account's catalog row, which lists the model's window as
      // Claude Code last reported it, or none at all.
      const reportingModel = (contextLength?: number) =>
        createMockAIGatewayModel({
          contextLength,
          providerConfigId: `reporting-${StoreId.newSessionId()}`,
        });

      it("budgets against the reported window where the catalog has none", async () => {
        const model = reportingModel();
        await save(userMessage("First question"));
        await save(assistantMessageWithUsage("getting full", 700));
        expect(noticeIn(await prepare(model))).toBeUndefined();

        noteReportedContextLength(model, 1000);

        expect(noticeIn(await prepare(model))).toContain(
          "tokens of context remain",
        );
      });

      it("rolls over against the reported window rather than the catalog's", async () => {
        const model = reportingModel(1_000_000);
        noteReportedContextLength(model, 1000);
        await save(userMessage("First question"));
        for (let index = 0; index < 4; index++) {
          await save(assistantMessageWithUsage(`turn ${index}`, 900));
        }

        const texts = modelTexts(await prepare(model));

        expect(await storedBoundary()).toBeDefined();
        expect(texts.some((text) => text.includes("turn 0"))).toBe(false);
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
        const before = await ChatReads.transcript({ sessionId, chatId });
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
          const result = await ChatReads.transcript({
            sessionId,
            chatId,
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

      it("hands back the notes the agent left, in the request itself", async () => {
        await fs.mkdir(chatDir(chatId), { recursive: true });
        await fs.writeFile(
          path.join(chatDir(chatId), "handoff-notes.md"),
          "Format: the number, then the English word.",
          "utf8",
        );
        await fillPast(4);

        const messages = await prepare(smallWindowModel);
        const notice = modelTexts(messages).find((text) =>
          text.includes("<context-rollover>"),
        );

        // Inlined, not pointed at. An agent told where its notes were did not
        // spend the tool call to go and get them.
        expect(notice).toContain("Format: the number, then the English word.");
      });

      it("says so plainly when the agent left none", async () => {
        await fillPast(4);

        const messages = await prepare(smallWindowModel);
        const notice = modelTexts(messages).find((text) =>
          text.includes("<context-rollover>"),
        );

        expect(notice).toContain("No handoff notes were found");
        expect(notice).toContain(
          shellPath(path.join(chatDir(chatId), "handoff-notes.md")),
        );
      });

      // The failure this exists for was not the turn after the cut. An agent
      // told once, on the turn it rolled over, answered three further turns in
      // a format it had lost with its own history.
      it("keeps saying so on later turns, not only the one that rolled over", async () => {
        await fillPast(4);
        await prepare(smallWindowModel);

        await save(userMessage("and again"));
        const later = await prepare(smallWindowModel);

        expect(
          modelTexts(later).some((text) => text.includes("<context-rollover>")),
        ).toBe(true);
      });

      it("says nothing about a rollover in a session that never had one", async () => {
        await save(userMessage("First question"));
        await save(assistantMessageWithUsage("plenty of room", 100));

        expect(
          modelTexts(await prepare(smallWindowModel)).some((text) =>
            text.includes("<context-rollover>"),
          ),
        ).toBe(false);
      });

      it("marks it once, not again on every later turn", async () => {
        await fillPast(4);

        await prepare(smallWindowModel);
        await prepare(smallWindowModel);

        expect(await storedRolloverParts()).toHaveLength(1);
      });
    });

    describe("a model switch", () => {
      // Roomy enough that the small model's whole usable window is noise in it,
      // so what these tests turn on is which window is being read rather than
      // where a threshold happens to fall.
      const roomyModel = createMockAIGatewayModel({
        canonicalId: "roomy-model-id",
        contextLength: 100_000,
      });

      /** The same turn, as the model that ran before the switch reported it. */
      function fromAnotherModel(
        message: SessionMessage.AssistantWithParts,
      ): SessionMessage.AssistantWithParts {
        return {
          ...message,
          metadata: { ...message.metadata, modelId: "roomy-model-id" },
        };
      }

      /** A conversation the previous model filled, before the switch. */
      async function fillPastOnAnotherModel(turns: number) {
        await save(userMessage("First question"));
        for (let index = 0; index < turns; index++) {
          await save(
            fromAnotherModel(assistantMessageWithUsage(`turn ${index}`, 900)),
          );
        }
      }

      async function storedModelChangeParts() {
        const result = await ChatReads.transcript({ sessionId, chatId });
        return result
          ._unsafeUnwrap()
          .flatMap((message) => message.parts)
          .filter((part) => part.type === "data-modelChange");
      }

      it("records the move, with the window either side of it", async () => {
        await fillPastOnAnotherModel(4);

        await prepare(smallWindowModel);

        const parts = await storedModelChangeParts();

        expect(parts).toHaveLength(1);
        expect(parts[0]?.data).toEqual({
          from: {
            contextLength: undefined,
            modelId: "roomy-model-id",
            name: undefined,
          },
          to: {
            contextLength: 1000,
            modelId: "mock-model-id",
            name: "Mock Model",
            providerName: "Test Provider",
          },
        });
      });

      it("records it once, not again on every later turn", async () => {
        await fillPastOnAnotherModel(4);
        await prepare(smallWindowModel);

        await save(assistantMessageWithUsage("answered here", 100));
        await save(userMessage("and again"));
        await prepare(smallWindowModel);

        expect(await storedModelChangeParts()).toHaveLength(1);
      });

      it("tells the model of the switch on the turn it starts answering", async () => {
        await save(userMessage("First question"));
        await save(fromAnotherModel(assistantMessageWithUsage("answer", 100)));
        await save(userMessage("Next question"));

        const told = (texts: string[]) =>
          texts.filter((text) => text.includes("switched this chat's model"));

        expect(told(modelTexts(await prepare(smallWindowModel))))
          .toMatchInlineSnapshot(`
          [
            "
          <instrument-system-note>
          The user switched this chat's model from Roomy Model Id to Mock Model. From this turn on you run on Mock Model from Test Provider; this supersedes the model named above.
          </instrument-system-note>",
          ]
        `);
        // The same bytes on the next turn, so the cached prefix holds.
        expect(told(modelTexts(await prepare(smallWindowModel)))).toHaveLength(
          1,
        );
      });

      it("records nothing for a session that never switched", async () => {
        await save(userMessage("First question"));
        await save(assistantMessageWithUsage("plenty of room", 100));

        await prepare(smallWindowModel);

        expect(await storedModelChangeParts()).toHaveLength(0);
      });

      it("warns on a count carried over from the model that ran before", async () => {
        await fillPastOnAnotherModel(4);

        const messages = await prepare(smallWindowModel);

        // The warning is the whole mechanism for carrying a task across a
        // reset, so it is the one thing a carried-over count must still buy.
        expect(noticeIn(messages)).toContain("used all");
      });

      it("does not reset on it, however far past the window it reads", async () => {
        await fillPastOnAnotherModel(4);

        await prepare(smallWindowModel);

        expect(await storedBoundary()).toBeUndefined();
      });

      it("resets once the model being asked has reported a count of its own", async () => {
        await fillPastOnAnotherModel(4);
        await prepare(smallWindowModel);
        await save(assistantMessageWithUsage("first turn here", 900));

        await prepare(smallWindowModel);

        expect(await storedBoundary()).toBeDefined();
      });

      it("resets on a refused request without waiting for that count", async () => {
        // Otherwise nothing ends this: a refused turn reports no usage, so the
        // next turn reads the same carried-over count, defers again, and sends
        // the same oversized request forever.
        await fillPastOnAnotherModel(4);
        await save(refusedForSize());

        await prepare(smallWindowModel);

        expect(await storedBoundary()).toBeDefined();
      });

      it("stops narrowing the history once a model has room for all of it", async () => {
        await save(userMessage("First question"));
        for (let index = 0; index < 4; index++) {
          await save(assistantMessageWithUsage(`turn ${index}`, 900));
        }
        await prepare(smallWindowModel);
        expect(
          modelTexts(await prepare(smallWindowModel)).some((text) =>
            text.includes("turn 0"),
          ),
        ).toBe(false);

        const messages = await prepare(roomyModel);

        expect(
          modelTexts(messages).some((text) => text.includes("turn 0")),
        ).toBe(true);
        expect(
          modelTexts(messages).some((text) =>
            text.includes("<context-rollover>"),
          ),
        ).toBe(false);
      });

      it("leaves the boundary on disk, so returning to the small window restores it", async () => {
        await save(userMessage("First question"));
        for (let index = 0; index < 4; index++) {
          await save(assistantMessageWithUsage(`turn ${index}`, 900));
        }
        await prepare(smallWindowModel);
        const boundary = await storedBoundary();

        await prepare(roomyModel);

        expect(await storedBoundary()).toBe(boundary);
        expect(
          modelTexts(await prepare(smallWindowModel)).some((text) =>
            text.includes("turn 0"),
          ),
        ).toBe(false);
      });
    });

    describe("a boundary decided once for each model", () => {
      /**
       * One model, as two processes serve it: the provider connection a
       * window is reported under, and another that has heard nothing, which
       * is what a restart or another computer is to the in-memory reports.
       */
      const served = () =>
        createMockAIGatewayModel({
          canonicalId: "decided-model-id",
          contextLength: 1000,
          providerConfigId: `served-${StoreId.newSessionId()}`,
        });

      /** A session rolled over under the small window. */
      async function rolledOver() {
        await save(userMessage("First question"));
        for (let index = 0; index < 4; index++) {
          await save(assistantMessageWithUsage(`turn ${index}`, 900));
        }
        await prepare(smallWindowModel);
        expect(await storedBoundary()).toBeDefined();
      }

      const sendsTurn0 = (messages: ModelMessage[]) =>
        modelTexts(messages).some((text) => text.includes("turn 0"));

      async function storedWindows() {
        const result = await ChatReads.session({ chatId, sessionId });
        return result._unsafeUnwrap().rolloverWindows;
      }

      it("keeps a boundary it held after the provider reports a larger window", async () => {
        await rolledOver();
        expect(sendsTurn0(await prepare(served()))).toBe(false);

        const reporting = served();
        noteReportedContextLength(reporting, 100_000);

        expect(sendsTurn0(await prepare(reporting))).toBe(false);
        expect((await storedWindows())?.["decided-model-id"]).toEqual({
          lifted: false,
          usableTokens: 800,
        });
      });

      it("keeps a boundary it lifted once the reported window is forgotten", async () => {
        await rolledOver();
        const reporting = served();
        noteReportedContextLength(reporting, 100_000);
        expect(sendsTurn0(await prepare(reporting))).toBe(true);

        expect(sendsTurn0(await prepare(served()))).toBe(true);
        expect((await storedWindows())?.["decided-model-id"]?.lifted).toBe(
          true,
        );
      });

      it("decides nothing for a model whose window is unknown, holding the boundary", async () => {
        await rolledOver();

        const unknown = createMockAIGatewayModel({
          canonicalId: "unknown-window-model-id",
        });

        expect(sendsTurn0(await prepare(unknown))).toBe(false);
        expect(
          (await storedWindows())?.["unknown-window-model-id"],
        ).toBeUndefined();
      });

      // A lifted history that outgrows the window is refused like any other
      // request, and the refusal rolls the session over again, under a new
      // boundary whose only verdict is the model it was drawn for.
      it("rolls a lifted history over again when the provider refuses it for size", async () => {
        await rolledOver();
        const first = await storedBoundary();
        const reporting = served();
        noteReportedContextLength(reporting, 100_000);
        await prepare(reporting);
        // It answers once in the lifted window, then is refused.
        await save(assistantMessageWithUsage("answered lifted", 50_000));
        await save(refusedForSize());

        await prepare(reporting);

        expect(await storedBoundary()).not.toBe(first);
        expect(await storedWindows()).toEqual({
          "decided-model-id": { lifted: false, usableTokens: 80_000 },
        });
      });
    });

    describe("a request the provider refused for size", () => {
      it("resets a session whose window the provider never reported", async () => {
        // Budgeting is off for this model and cannot be turned on, so the
        // refusal is the only evidence of a ceiling the session will ever get.
        await save(userMessage("First question"));
        for (let index = 0; index < 4; index++) {
          await save(assistantMessageWithUsage(`turn ${index}`, 900));
        }
        await save(refusedForSize());

        await prepare(anthropicModel);

        expect(await storedBoundary()).toBeDefined();
      });

      it("resets a session the arithmetic reads as having room to spare", async () => {
        // The advertised window was wrong, or something outside the transcript
        // took the room. Either way the provider outranks the arithmetic.
        await save(userMessage("First question"));
        for (let index = 0; index < 4; index++) {
          await save(assistantMessageWithUsage(`turn ${index}`, 10));
        }
        await save(refusedForSize());

        await prepare(smallWindowModel);

        expect(await storedBoundary()).toBeDefined();
      });

      it("leaves a session alone when the turn before it succeeded", async () => {
        await save(userMessage("First question"));
        for (let index = 0; index < 4; index++) {
          await save(assistantMessageWithUsage(`turn ${index}`, 10));
        }

        await prepare(smallWindowModel);

        expect(await storedBoundary()).toBeUndefined();
      });
    });
  });
});
