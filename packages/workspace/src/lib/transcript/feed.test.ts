import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import {
  applyFeedEvent,
  applyOlder,
  lastTurnsOf,
  type TranscriptFeed,
  type TranscriptFeedEvent,
  TranscriptProjection,
} from "./feed";

const sessionId = StoreId.newSessionId();

function stored(
  role: "assistant" | "user",
  parts: (id: StoreId.Message) => unknown[],
  id = StoreId.newMessageId(),
): SessionMessage.WithParts {
  const metadata = {
    createdAt: new Date(0),
    sessionId,
    ...(role === "assistant"
      ? { finishReason: "stop", modelId: "m", providerId: "p" }
      : {}),
  };
  // Only the fields the projection reads.
  return {
    id,
    metadata,
    parts: parts(id),
    role,
  } as unknown as SessionMessage.WithParts;
}

const partMeta = (messageId: StoreId.Message, id = StoreId.newPartId()) => ({
  createdAt: new Date(0),
  id,
  messageId,
  sessionId,
});
const text = (
  messageId: StoreId.Message,
  words: string,
  id?: StoreId.Part,
  state = "streaming",
) =>
  ({
    metadata: partMeta(messageId, id),
    state,
    text: words,
    type: "text",
  }) as SessionMessagePart.Type;
const typed = (words: string) =>
  stored("user", (id) => [text(id, words, undefined, "done")]);

describe("TranscriptProjection", () => {
  it("sends only the words a token adds", () => {
    const messageId = StoreId.newMessageId();
    const partId = StoreId.newPartId();
    const reply = (words: string) =>
      stored("assistant", (id) => [text(id, words, partId)], messageId);
    const projection = new TranscriptProjection(false);
    const first = projection.reset([typed("Hi"), reply("Good")]);
    const next = projection.update({
      changed: [reply("Good day")],
      removed: [],
    });
    expect(next).toEqual({
      kind: "change",
      patches: [{ kind: "append", messageId, partId, text: " day" }],
      removed: [],
      upserted: [],
    });
    if (!next) {
      throw new Error("Nothing was sent");
    }
    const held = applyFeedEvent(applyFeedEvent(undefined, first), next);
    const last = held.messages.at(-1)?.parts[0];
    expect(last?.type === "text" && last.text).toBe("Good day");
  });

  it("sends nothing when what changed does not show", () => {
    const messageId = StoreId.newMessageId();
    const partId = StoreId.newPartId();
    const reply = () =>
      stored(
        "assistant",
        (id) => [
          text(id, "Done", partId, "done"),
          { metadata: partMeta(id), type: "step-start" },
        ],
        messageId,
      );
    const projection = new TranscriptProjection(false);
    projection.reset([reply()]);
    expect(
      projection.update({ changed: [reply()], removed: [] }),
    ).toBeUndefined();
  });

  it("patches a call's part without touching its step, which shares its id", () => {
    const messageId = StoreId.newMessageId();
    const partId = StoreId.newPartId();
    const metadata = {
      createdAt: new Date(0),
      id: partId,
      messageId,
      sessionId,
    };
    const step = { metadata, status: "done", tool: "tool-x", type: "step" };
    const tool = {
      input: {},
      metadata,
      state: "input-available",
      type: "tool-x",
    };
    const held = {
      hasOlder: false,
      messages: [
        { id: messageId, metadata: {}, parts: [step, tool], role: "assistant" },
      ],
    } as unknown as TranscriptFeed;
    const next = applyFeedEvent(held, {
      kind: "change",
      patches: [
        {
          kind: "part",
          messageId,
          part: { ...tool, state: "output-available" },
        },
      ],
      removed: [],
      upserted: [],
    } as unknown as TranscriptFeedEvent);
    expect(next.messages[0]?.parts.map((part) => part.type)).toEqual([
      "step",
      "tool-x",
    ]);
  });

  it.each([
    [
      "a sign-in's running step when its card lands",
      "tool-connect_app",
      { state: "input-available" },
      {
        output: {
          kind: "sign-in",
          name: "Notion",
          slug: "notion",
          state: "asked",
        },
        state: "output-available",
      },
    ],
    [
      "a question's step when it finishes streaming",
      "tool-choose",
      { state: "input-streaming" },
      { state: "input-available" },
    ],
  ])("replaces %s", (_name, type, before, after) => {
    const messageId = StoreId.newMessageId();
    const partId = StoreId.newPartId();
    const call = (state: object) =>
      stored(
        "assistant",
        (id) => [
          {
            input: { apps: ["notion"], questions: [] },
            metadata: partMeta(id, partId),
            toolCallId: "call",
            type,
            ...state,
          },
        ],
        messageId,
      );
    const projection = new TranscriptProjection(false);
    const first = projection.reset([typed("Hi"), call(before)]);
    const next = projection.update({ changed: [call(after)], removed: [] });
    if (!next) {
      throw new Error("Nothing was sent");
    }
    const held = applyFeedEvent(applyFeedEvent(undefined, first), next);
    expect(held.messages.at(-1)?.parts.map((part) => part.type)).toEqual([
      type,
    ]);
  });

  it("leaves what did not move as the same objects", () => {
    const a = typed("One");
    const projection = new TranscriptProjection(false);
    const held = applyFeedEvent(undefined, projection.reset([a]));
    const added = stored("assistant", (id) => [text(id, "Reply")]);
    const event = projection.update({ changed: [added], removed: [] });
    if (!event) {
      throw new Error("Nothing was sent");
    }
    const next = applyFeedEvent(held, event);
    expect(next.messages[0]).toBe(held.messages[0]);
    expect(next.messages).toHaveLength(2);
  });

  it("carries a step that keeps a call's words out of what is sent", () => {
    const messageId = StoreId.newMessageId();
    const partId = StoreId.newPartId();
    const call = (output: string) =>
      stored(
        "assistant",
        (id) => [
          {
            input: { command: "cat big" },
            metadata: { ...partMeta(id, partId), startedAt: new Date(0) },
            output: { exitCode: 0, output },
            state: "output-available",
            toolCallId: "x",
            type: "tool-bash",
          },
        ],
        messageId,
      );
    const projection = new TranscriptProjection(false);
    const first = projection.reset([call("x".repeat(100_000))]);
    expect(JSON.stringify(first).length).toBeLessThan(2000);
  });
});

describe("paging", () => {
  const session = Array.from({ length: 5 }, (_, turn) => [
    typed(`Turn ${turn.toString()}`),
    stored("assistant", (id) => [text(id, `Reply ${turn.toString()}`)]),
  ]).flat();

  it("gives the last turns whole, and says more are above them", () => {
    const feed = lastTurnsOf(session, { isDeveloperMode: false, turns: 2 });
    expect(feed.hasOlder).toBe(true);
    expect(feed.messages).toHaveLength(4);
    expect(feed.messages[0]?.id).toBe(session[6]?.id);
  });

  it("reads the page before a message, and puts it above what is held", () => {
    const held = lastTurnsOf(session, { isDeveloperMode: false, turns: 2 });
    const older = lastTurnsOf(session, {
      before: held.messages[0]?.id,
      isDeveloperMode: false,
      turns: 2,
    });
    const both = applyOlder(held, older);
    expect(both.messages[0]?.id).toBe(session[2]?.id);
    expect(both.messages).toHaveLength(8);
    expect(both.hasOlder).toBe(true);
  });

  it("gives the whole of a short session and says nothing is above it", () => {
    const feed = lastTurnsOf(session, { isDeveloperMode: false });
    expect(feed.hasOlder).toBe(false);
    expect(feed.messages).toHaveLength(session.length);
  });
});
