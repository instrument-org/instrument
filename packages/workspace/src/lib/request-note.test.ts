import { describe, expect, it } from "vitest";

import { SessionMessage } from "../schemas/session/message";
import { SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { TOOLS_FOR_MODEL_OUTPUT } from "../tools/all";
import { dataPartVisibility } from "./data-part-visibility";
import { requestNotesIn, transientNote } from "./prepare-model-messages";
import { developerNotesWithBodies } from "./transcript/developer-notes";
import { transcriptMessage } from "./transcript/transcript-message";

const sessionId = StoreId.newSessionId();
const meta = (messageId: StoreId.Message) => ({
  createdAt: new Date(0),
  id: StoreId.newPartId(),
  messageId,
  sessionId,
});

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

const said = (id: StoreId.Message, text: string) =>
  ({
    metadata: meta(id),
    state: "done",
    text,
    type: "text",
  }) as SessionMessagePart.Type;
const requestNote = (id: StoreId.Message) =>
  ({
    data: { kind: "turn", text: "A note for one request." },
    metadata: meta(id),
    type: "data-requestNote",
  }) as SessionMessagePart.Type;

const withoutNotes = (messages: SessionMessage.WithParts[]) =>
  messages.map((one) => ({
    ...one,
    parts: one.parts.filter((part) => part.type !== "data-requestNote"),
  }));

describe("a request's note, as a hidden part", () => {
  it.each([
    [
      "on a reply with words",
      (id: StoreId.Message) => [requestNote(id), said(id, "Done.")],
    ],
    [
      "on a reply with nothing else",
      (id: StoreId.Message) => [requestNote(id)],
    ],
  ])("leaves the model's messages byte for byte %s", async (_case, build) => {
    const messages = [
      message("user", (id) => [said(id, "Do it")]),
      message("assistant", build),
      message("user", (id) => [said(id, "Now this")]),
    ];
    const withPart = await SessionMessage.toModelMessages(
      messages,
      TOOLS_FOR_MODEL_OUTPUT,
    );
    const without = await SessionMessage.toModelMessages(
      withoutNotes(messages),
      TOOLS_FOR_MODEL_OUTPUT,
    );
    expect(JSON.stringify(withPart)).toBe(JSON.stringify(without));
  });

  it("stays out of what the column reads", () => {
    const reply = message("assistant", (id) => [
      requestNote(id),
      said(id, "Done."),
    ]);
    expect(transcriptMessage(reply)?.parts.map((part) => part.type)).toEqual([
      "text",
    ]);
    const [part] = reply.parts;
    expect(
      part && dataPartVisibility(part as SessionMessagePart.DataPart),
    ).toBe("hidden");
  });

  it("reads harmlessly to a build that has never heard of it", () => {
    const [part] = message("assistant", (id) => [requestNote(id)]).parts;
    const stored = part && {
      ...part,
      type: "data-writtenByALaterBuild",
    };
    const read = SessionMessagePart.coerce(
      stored as unknown as Parameters<typeof SessionMessagePart.coerce>[0],
    );
    expect(read.type).toBe("data-unknown");
    expect(dataPartVisibility(read as SessionMessagePart.DataPart)).toBe("dev");
  });

  it("shows beside the first row the request produced, on the left", () => {
    const reply = message("assistant", (id) => [
      requestNote(id),
      said(id, "Done."),
    ]);
    const { bodies, notes } = developerNotesWithBodies(
      [message("user", (id) => [said(id, "Do it")]), reply],
      { sessionId },
    );
    expect(notes).toMatchObject([
      { row: reply.parts[1]?.metadata.id, side: "left" },
    ]);
    expect(bodies.get(notes[0]?.id ?? "")?.wasSent).toBe(true);
  });
});

describe("transientNote", () => {
  it("reports each note it made, in the order they went on, and no other", () => {
    const messages = [
      { content: "Someone else's", role: "user" as const },
      transientNote("rollover", "First"),
      transientNote("budget", "Second"),
    ];
    expect(requestNotesIn(messages)).toEqual([
      { kind: "rollover", text: "First" },
      { kind: "budget", text: "Second" },
    ]);
  });
});
