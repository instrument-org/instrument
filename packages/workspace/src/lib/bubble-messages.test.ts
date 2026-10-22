import { describe, expect, it } from "vitest";

import { createSystemMessage } from "../agents/shared";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import {
  applyBubbleFeedEvent,
  type BubbleFeed,
  BubbleProjection,
  bubbleMessage,
} from "./bubble-messages";

const sessionId = StoreId.newSessionId();
const at = new Date("2026-10-20T10:00:00Z");

function partMetadata(messageId: StoreId.Message) {
  return { createdAt: at, id: StoreId.newPartId(), messageId, sessionId };
}

function user(text: string): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: { createdAt: at, sessionId },
    parts: [{ metadata: partMetadata(id), state: "done", text, type: "text" }],
    role: "user",
  };
}

type PartOf = (messageId: StoreId.Message) => SessionMessagePart.Type;

const text =
  (words: string): PartOf =>
  (messageId) => ({
    metadata: partMetadata(messageId),
    state: "done",
    text: words,
    type: "text",
  });

const reasoning =
  (words: string): PartOf =>
  (messageId) => ({
    metadata: partMetadata(messageId),
    state: "done",
    text: words,
    type: "reasoning",
  });

const modelChange: PartOf = (messageId) => ({
  data: {
    from: { modelId: "a", name: "Model A" },
    to: { modelId: "b", name: "Model B" },
  },
  metadata: partMetadata(messageId),
  type: "data-modelChange",
});

const memory: PartOf = (messageId) => ({
  data: {
    forgotten: [],
    memories: [],
    more: 0,
    sentAt: 0,
    tells: "whole",
    told: {},
  },
  metadata: partMetadata(messageId),
  type: "data-memory",
});

function assistant(
  parts: PartOf[],
  { finished = true }: { finished?: boolean } = {},
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: {
      createdAt: at,
      finishReason: "stop",
      ...(finished ? { finishedAt: at } : {}),
      modelId: "model",
      providerId: "provider",
      sessionId,
    },
    parts: parts.map((part) => part(id)),
    role: "assistant",
  };
}

const kinds = (message: SessionMessage.WithParts | undefined) =>
  message?.parts.map((part) => part.type);

describe("bubbleMessage", () => {
  it("keeps words and notes everyone sees, and drops steps and developer notes", () => {
    const message = assistant([
      reasoning("thinking"),
      text("Here it is."),
      modelChange,
      memory,
    ]);
    expect(kinds(bubbleMessage(message, { composing: false }))).toEqual([
      "text",
      "data-modelChange",
    ]);
  });

  it("draws no command, and a question only once the whole of it has arrived", () => {
    const ask =
      (state: "input-available" | "input-streaming"): PartOf =>
      (messageId) => ({
        input: { choices: ["This", "That"], question: "Which one?" },
        metadata: partMetadata(messageId),
        state,
        toolCallId: StoreId.ToolCallSchema.parse("call-ask"),
        type: "tool-choose",
      });
    const command: PartOf = (messageId) => ({
      input: { command: "ls", explanation: "Listing", yieldMs: 1000 },
      metadata: partMetadata(messageId),
      state: "input-available",
      toolCallId: StoreId.ToolCallSchema.parse("call-ls"),
      type: "tool-bash",
    });
    expect(
      kinds(
        bubbleMessage(assistant([command, ask("input-streaming")]), {
          composing: false,
        }),
      ),
    ).toEqual([]);
    expect(
      kinds(
        bubbleMessage(assistant([ask("input-available")]), {
          composing: false,
        }),
      ),
    ).toEqual(["tool-choose"]);
  });

  it("keeps an image call only when it ran into a sign-in or the plan", () => {
    const failed =
      (errorType: "api-call" | "no-image-model" | "refused"): PartOf =>
      (messageId) => ({
        input: { filePath: "header", prompt: "A help desk team" },
        metadata: { ...partMetadata(messageId), endedAt: at },
        output: { errorMessage: "", errorType, state: "failure" },
        state: "output-available",
        toolCallId: StoreId.ToolCallSchema.parse("call-image"),
        type: "tool-generate_image",
      });
    expect(
      (["no-image-model", "refused", "api-call"] as const).map(
        (errorType) =>
          kinds(
            bubbleMessage(assistant([failed(errorType)]), {
              composing: false,
            }),
          )?.length,
      ),
    ).toEqual([1, 1, 0]);
  });

  it("keeps a search only when Instrument turned it away for the plan", () => {
    const searched =
      (refused: boolean): PartOf =>
      (messageId) => ({
        input: { explanation: "Searching", query: "weather" },
        metadata: { ...partMetadata(messageId), endedAt: at },
        output: {
          ...(refused && {
            platformRefusal: { code: "usage-limit-exceeded" as const },
          }),
          results: { kind: "excerpts", sources: [] },
          state: "success",
        },
        state: "output-available",
        toolCallId: StoreId.ToolCallSchema.parse("call-search"),
        type: "tool-web_search",
      });
    expect(
      [true, false].map(
        (refused) =>
          kinds(
            bubbleMessage(assistant([searched(refused)]), { composing: false }),
          )?.length,
      ),
    ).toEqual([1, 0]);
  });

  it("holds back the words of a reply still being written", () => {
    const message = assistant([text("Half a sen")], { finished: false });
    expect(kinds(bubbleMessage(message, { composing: true }))).toEqual([]);
  });

  it("hands back the same object when nothing is dropped", () => {
    const message = user("hello");
    expect(bubbleMessage(message, { composing: false })).toBe(message);
  });
});

describe("BubbleProjection", () => {
  it("sends nothing while tokens stream into a reply, and the reply once it lands", () => {
    const projection = new BubbleProjection();
    const asked = user("Write a poem");
    const writing = assistant([text("Roses")], { finished: false });

    const first = projection.update({
      isRunning: true,
      messages: [asked, writing],
    });
    expect(first.event?.kind).toBe("reset");
    expect(first.feed.drafting).toBe(true);

    const more = { ...writing, parts: [text("Roses are red")(writing.id)] };
    const streaming = projection.update({
      isRunning: true,
      messages: [asked, more],
      touched: new Set([writing.id]),
    });
    expect(streaming.event).toBeUndefined();

    if (more.role !== "assistant") {
      throw new TypeError("the reply is the assistant's");
    }
    const done: SessionMessage.WithParts = {
      ...more,
      metadata: { ...more.metadata, finishedAt: at },
    };
    const landed = projection.update({
      isRunning: false,
      messages: [asked, done],
      touched: new Set([writing.id]),
    });
    expect(landed.event).toMatchObject({
      drafting: false,
      kind: "change",
      removed: [],
    });
    expect(kinds(landed.feed.messages[1])).toEqual(["text"]);
  });

  // A session's first request creates its reply, then writes the baseline
  // the request is sent with, so the baseline's messages come after it.
  it("holds back the first reply of a session behind the baseline written after it", () => {
    const asked = user("Count my files");
    const writing = assistant([text("Count")], { finished: false });
    const baseline = createSystemMessage({
      agentName: "instrument",
      now: at,
      sessionId,
      text: "You are Instrument.",
    });
    const { feed } = new BubbleProjection().update({
      isRunning: true,
      messages: [asked, writing, baseline],
    });
    expect(feed.drafting).toBe(true);
    expect(kinds(feed.messages[1])).toEqual([]);
  });

  it("shows a reply whose run ended before it finished", () => {
    const projection = new BubbleProjection();
    const cut = assistant([text("Cut off mid")], { finished: false });
    projection.update({ isRunning: true, messages: [cut] });
    const ended = projection.update({
      isRunning: false,
      messages: [cut],
      touched: new Set(),
    });
    expect(kinds(ended.feed.messages[0])).toEqual(["text"]);
  });
});

describe("applyBubbleFeedEvent", () => {
  it("replaces, removes and inserts messages in session order", () => {
    const [a, b, c] = [user("a"), user("b"), user("c")];
    const start: BubbleFeed = { drafting: false, messages: [a, c] };
    const bAgain = user("b2");
    const next = applyBubbleFeedEvent(start, {
      drafting: true,
      kind: "change",
      removed: [c.id],
      upserted: [b, { ...a, parts: bAgain.parts }],
    });
    expect(next.drafting).toBe(true);
    expect(next.messages.map((message) => message.id)).toEqual([a.id, b.id]);
    expect(next.messages[0]?.parts).toBe(bAgain.parts);
  });
});
