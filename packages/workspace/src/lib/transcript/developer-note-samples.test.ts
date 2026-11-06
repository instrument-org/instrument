import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SessionMessage } from "../../schemas/session/message";
import { SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { DATA_PART_SAMPLES } from "./developer-note-samples";
import { developerNotesWithBodies } from "./developer-notes";

const sessionId = StoreId.newSessionId();
const NAMES = SessionMessageDataPart.NameSchema.options;

/** Parts recorded on a step, which the next user message carries. */
const CARRIED = new Set(["maxSteps", "outputLimit", "setupChanges"]);

const meta = (messageId: StoreId.Message) => ({
  createdAt: new Date(0),
  id: StoreId.newPartId(),
  messageId,
  sessionId,
});

const words = (messageId: StoreId.Message, text: string) =>
  ({
    metadata: meta(messageId),
    state: "done",
    text,
    type: "text",
  }) as SessionMessagePart.Type;

function message(
  role: "assistant" | "user",
  build: (id: StoreId.Message) => SessionMessagePart.Type[],
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: {
      createdAt: new Date(0),
      sessionId,
      ...(role === "assistant" ? { modelId: "m", providerId: "p" } : {}),
    },
    parts: build(id),
    role,
  } as SessionMessage.WithParts;
}

/** A session with the sample where its writer records it, and without it. */
function sessionsWith(name: (typeof NAMES)[number]) {
  const part = (id: StoreId.Message) =>
    ({
      data: DATA_PART_SAMPLES[name],
      metadata: meta(id),
      type: `data-${name}`,
    }) as SessionMessagePart.Type;
  if (CARRIED.has(name)) {
    const session = (withPart: boolean) => [
      message("user", (id) => [words(id, "First")]),
      message("assistant", (id) => [
        words(id, "So far."),
        ...(withPart ? [part(id)] : []),
      ]),
      message("user", (id) => [words(id, "Next")]),
    ];
    return { with: session(true), without: session(false) };
  }
  const session = (withPart: boolean) => [
    message("user", (id) => [
      words(id, "First"),
      ...(withPart ? [part(id)] : []),
    ]),
  ];
  return { with: session(true), without: session(false) };
}

/** The text a session's user turns carry, in the request's own words. */
const heardIn = (messages: SessionMessage.WithParts[]) =>
  SessionMessage.toUIMessages(messages).flatMap((one) =>
    one.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])),
  );

describe("every data part", () => {
  it.each(NAMES)("%s's sample is what its schema reads", (name) => {
    expect(
      SessionMessageDataPart.parseDataPayload(name, DATA_PART_SAMPLES[name]),
    ).toMatchObject({ ok: true });
  });

  it.each(NAMES)("%s has a card for whatever reaches the model", (name) => {
    const { with: withPart, without } = sessionsWith(name);
    const before = heardIn(without);
    const notes = heardIn(withPart).filter(
      (text) => !before.includes(text) && !text.includes("user_message"),
    );
    const { bodies } = developerNotesWithBodies(withPart, { sessionId });
    const cards = [...bodies.values()]
      .filter((body) => body.wasSent)
      .map((body) => body.text);
    for (const note of notes) {
      expect(cards).toContain(note);
    }
  });
});

interface OldShape {
  data: unknown;
  /** Where this shape was seen, or why it's kept. */
  note: string;
  /** What the part type reads as now. */
  reads: string;
  type: string;
}

const OLD_SHAPES = JSON.parse(
  readFileSync(new URL("./old-part-shapes.json", import.meta.url), "utf8"),
) as OldShape[];

/**
 * A frozen file of what's on people's disks. A schema change that stops a shape
 * reading fails here, so retiring one has to be stated in the same diff, by
 * changing what the file says it reads as.
 */
describe("old part shapes", () => {
  it.each(OLD_SHAPES)(
    "$type ($note) reads as $reads",
    ({ data, reads, type }) => {
      const read = SessionMessagePart.coerce({
        data,
        metadata: meta(StoreId.newMessageId()),
        type,
      } as unknown as Parameters<typeof SessionMessagePart.coerce>[0]);
      expect(read.type).toBe(reads);
    },
  );

  it("names every part of this build", () => {
    const frozen = new Set(OLD_SHAPES.map((shape) => shape.type));
    expect(NAMES.filter((name) => !frozen.has(`data-${name}`))).toEqual([]);
  });
});
