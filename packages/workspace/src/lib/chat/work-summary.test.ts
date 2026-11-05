import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import {
  type TranscriptMessage,
  transcriptMessage,
} from "../transcript/transcript-message";
import { turnsOf } from "../transcript/turns-of";
import { needsSummary, summaryFrom, summaryInput } from "./work-summary";

const sessionId = StoreId.newSessionId();
const at = new Date("2026-11-05T12:00:00Z");
const meta = (messageId: StoreId.Message) => ({
  createdAt: at,
  id: StoreId.newPartId(),
  messageId,
  sessionId,
});

function message(
  role: "assistant" | "user",
  build: (id: StoreId.Message) => unknown[],
): TranscriptMessage {
  const id = StoreId.newMessageId();
  const stored = {
    id,
    metadata: {
      createdAt: at,
      sessionId,
      ...(role === "assistant" ? { finishedAt: at } : {}),
    },
    parts: build(id),
    role,
  };
  // A stored message as the store hands it back; only the fields read here.
  const light = transcriptMessage(
    stored as unknown as SessionMessage.WithParts,
  );
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

const call = (
  id: StoreId.Message,
  tool: string,
  input: Record<string, unknown>,
  output: unknown = { exitCode: 0 },
) => ({
  input,
  metadata: { ...meta(id), endedAt: at, startedAt: at },
  output,
  state: "output-available",
  toolCallId: StoreId.newPartId(),
  type: `tool-${tool}`,
});

const typed = message("user", (id) => [
  said(id, "Make a database of   the launch videos"),
]);

const worked = (id: StoreId.Message) =>
  call(id, "bash", {
    activity: "Adding the videos",
    command: "instrument app call notion create",
    explanation: "Adding the videos to the database",
  });

const summary = (id: StoreId.Message) => ({
  data: { words: "Made the database" },
  metadata: meta(id),
  type: "data-workSummary",
});

const reply = message("assistant", (id) => {
  const adding = worked(id);
  return [
    call(id, "write_file", {
      activity: "Writing the notes",
      content: "x",
      explanation: "Saving the notes",
      filePath: "notes/launch.md",
    }),
    adding,
    {
      data: {
        apps: [{ app: "notion", calls: 14, failed: 0, ms: 90, tool: "create" }],
        counts: [],
        files: [],
        hosts: [],
        settled: true,
        step: adding.metadata.id,
      },
      metadata: meta(id),
      type: "data-stepFacts",
    },
    said(id, "The database is ready, with all 14 videos in it."),
  ];
});

const turnOf = (...messages: TranscriptMessage[]) => {
  const turn = turnsOf(messages, { isRunning: false, sessionId }).at(-1);
  if (!turn) {
    throw new Error("No turn");
  }
  return turn;
};

describe("needsSummary", () => {
  it("wants a line for finished work that folds", () => {
    expect(needsSummary(turnOf(typed, reply))).toBe(true);
  });

  it("has nothing to say of a reply with no work", () => {
    expect(
      needsSummary(
        turnOf(
          typed,
          message("assistant", (id) => [said(id, "Hello")]),
        ),
      ),
    ).toBe(false);
  });

  it("wants no second line until there is more work", () => {
    const summarized = message("assistant", (id) => [
      worked(id),
      summary(id),
      said(id, "Done."),
    ]);
    expect(needsSummary(turnOf(typed, summarized))).toBe(false);
    expect(
      needsSummary(
        turnOf(
          typed,
          summarized,
          message("assistant", (id) => [worked(id), said(id, "More.")]),
        ),
      ),
    ).toBe(true);
  });
});

describe("summaryInput", () => {
  it("reads the ask, the steps, the record and how the reply opens", () => {
    expect(summaryInput(turnOf(typed, reply), ["Launch videos"]))
      .toMatchInlineSnapshot(`
        "The person's message: Make a database of the launch videos

        Steps, in order:
        - Writing the notes
          - Saving the notes
        - Adding the videos
          - Adding the videos to the database

        Tools: write_file 1, bash 1
        Apps called: notion (create 14)
        Files written or edited: launch.md
        Tasks started: Launch videos

        Start of the final reply: The database is ready, with all 14 videos in it."
      `);
  });
});

describe("summaryFrom", () => {
  it.each([
    [
      '"Read the page and made the database."',
      "Read the page and made the database",
    ],
    ["Made it\nAnd some more", "Made it"],
    ["", undefined],
    [`Did ${"a lot of things and ".repeat(10)}`, undefined],
  ])("%s", (answer, line) => {
    expect(summaryFrom(answer)).toBe(line);
  });
});
