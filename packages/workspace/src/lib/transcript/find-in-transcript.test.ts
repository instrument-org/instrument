import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { countMatches, findInTranscript } from "./find-in-transcript";
import {
  type TranscriptMessage,
  transcriptMessage,
} from "./transcript-message";

const sessionId = StoreId.newSessionId();
let clock = Date.parse("2026-11-10T12:00:00Z");
const tick = () => new Date((clock += 1000));
const meta = (messageId: StoreId.Message) => ({
  createdAt: tick(),
  id: StoreId.newPartId(),
  messageId,
  sessionId,
});

function message(
  role: "assistant" | "user",
  build: (id: StoreId.Message) => SessionMessagePart.Type[],
): TranscriptMessage {
  const id = StoreId.newMessageId();
  const metadata = {
    createdAt: tick(),
    sessionId,
    ...(role === "assistant"
      ? { finishedAt: tick(), modelId: "m", providerId: "p" }
      : {}),
  };
  // A stored message as the store hands it back; only the fields read here.
  const light = transcriptMessage({
    id,
    metadata,
    parts: build(id),
    role,
  } as unknown as SessionMessage.WithParts);
  if (!light) {
    throw new Error("Not a transcript message");
  }
  return light;
}

const said = (id: StoreId.Message, text: string) =>
  ({
    metadata: meta(id),
    state: "done",
    text,
    type: "text",
  }) as SessionMessagePart.Type;

const typed = (text: string) => message("user", (id) => [said(id, text)]);

const ran = (id: StoreId.Message) => {
  const startedAt = tick();
  return {
    input: { activity: "Working" },
    metadata: { ...meta(id), endedAt: tick(), startedAt },
    output: { exitCode: 0 },
    state: "output-available",
    toolCallId: StoreId.newPartId(),
    type: "tool-bash",
  } as unknown as SessionMessagePart.Type;
};

describe("findInTranscript", () => {
  it("counts the words each turn shows, and apart those its fold hides", () => {
    const first = typed("Find the apple");
    const messages = [
      first,
      message("assistant", (id) => [
        said(id, "Apple first."),
        ran(id),
        said(id, "An apple between steps."),
        ran(id),
        said(id, "Here is **the apple** and [an apple](https://apple.test)."),
      ]),
      typed("Nothing here"),
      message("assistant", (id) => [said(id, "Still nothing.")]),
      typed("APPLE again"),
    ];
    expect(findInTranscript({ messages, query: "apple", sessionId })).toEqual([
      { count: 5, folded: 1, id: first.id },
      { count: 1, folded: 0, id: messages[4]?.id },
    ]);
  });

  it.each([
    // A named activity of one call draws its name alone, so a line that
    // repeats it counts once and one that differs counts not at all.
    ["Comparing versions", "Comparing versions", "comparing versions", 1],
    ["Comparing versions", "Diffing the two files", "diffing", 0],
    // A call the agent said nothing about draws what kind of call it was.
    [undefined, undefined, "ran terminal command", 1],
  ])(
    "counts a one-call activity named %j with the line %j as its row draws it",
    (activity, explanation, query, count) => {
      const first = typed("Go");
      const messages = [
        first,
        message("assistant", (id) => [
          said(id, "On it."),
          {
            ...(ran(id) as object),
            input: { activity, explanation },
          } as SessionMessagePart.Type,
          said(id, "Done."),
        ]),
      ];
      expect(findInTranscript({ messages, query, sessionId })).toEqual(
        count === 0 ? [] : [{ count, folded: count, id: first.id }],
      );
    },
  );

  it("counts the summary on a folded turn's Worked row", () => {
    const first = typed("Go");
    const messages = [
      first,
      message("assistant", (id) => [
        ran(id),
        said(id, "Done."),
        {
          data: { words: "Checked the harbor budget" },
          metadata: meta(id),
          type: "data-workSummary",
        } as unknown as SessionMessagePart.Type,
      ]),
    ];
    expect(
      findInTranscript({ messages, query: "harbor budget", sessionId }),
    ).toEqual([{ count: 1, folded: 0, id: first.id }]);
  });

  it("reads Markdown's marks out of a reply", () => {
    const messages = [
      typed("Go"),
      message("assistant", (id) => [said(id, "It is **the end**.")]),
    ];
    expect(
      findInTranscript({ messages, query: "the end", sessionId }),
    ).toHaveLength(1);
  });

  it("finds nothing for an empty search", () => {
    expect(
      findInTranscript({ messages: [typed("Hi")], query: "", sessionId }),
    ).toEqual([]);
  });
});

describe("countMatches", () => {
  it.each([
    ["aaaa", "aa", 2],
    ["Apple apple APPLE", "apple", 3],
    ["", "x", 0],
    ["x", "", 0],
  ])("counts %j in %j", (text, query, count) => {
    expect(countMatches(text, query)).toBe(count);
  });
});
