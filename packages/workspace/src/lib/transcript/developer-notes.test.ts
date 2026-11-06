import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { developerNotes } from "./developer-notes";
import { transcriptMessage } from "./transcript-message";
import { turnsOf } from "./turns-of";

const sessionId = StoreId.newSessionId();
let clock = Date.parse("2026-11-05T12:00:00Z");
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
  extra: Record<string, unknown> = {},
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: {
      createdAt: tick(),
      sessionId,
      ...(role === "assistant"
        ? { finishedAt: tick(), modelId: "m", providerId: "p" }
        : {}),
      ...extra,
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
const thought = (id: StoreId.Message, text: string) =>
  ({
    metadata: meta(id),
    state: "done",
    text,
    type: "reasoning",
  }) as SessionMessagePart.Type;
const called = (id: StoreId.Message, activity: string) =>
  ({
    input: { activity },
    metadata: { ...meta(id), endedAt: tick(), startedAt: tick() },
    output: { exitCode: 0 },
    state: "output-available",
    toolCallId: StoreId.newPartId(),
    type: "tool-bash",
  }) as unknown as SessionMessagePart.Type;
const dateNote = (id: StoreId.Message) =>
  ({
    data: { date: "Friday" },
    metadata: meta(id),
    type: "data-dateChange",
  }) as SessionMessagePart.Type;
const cleared = (id: StoreId.Message) =>
  ({
    data: { results: 3, through: id },
    metadata: meta(id),
    type: "data-toolResultsCleared",
  }) as SessionMessagePart.Type;
const typed = (text: string) => message("user", (id) => [said(id, text)]);

const notesOf = (messages: SessionMessage.WithParts[]) =>
  developerNotes(messages, { sessionId });

describe("developerNotes", () => {
  it("puts what the person's message carried beside the message", () => {
    const sent = message("user", (id) => [said(id, "Hi"), dateNote(id)]);
    expect(notesOf([sent])).toMatchObject([
      { kind: "note", row: `message:${sent.id}`, side: "right" },
    ]);
  });

  it("puts a thought beside the row it led to, on the left", () => {
    const reply = message("assistant", (id) => [
      thought(id, "Let me look."),
      called(id, "Looking"),
      said(id, "Done."),
    ]);
    const [note] = notesOf([typed("Do it"), reply]);
    expect(note).toMatchObject({ kind: "thought", side: "left" });
    expect(note?.row).toBe(reply.parts[1]?.metadata.id);
    expect(note?.rowKind).toBe("activity");
  });

  it("puts a note on the agent's work beside the row it went out with", () => {
    const reply = message("assistant", (id) => [
      called(id, "Looking"),
      cleared(id),
      said(id, "Done."),
    ]);
    expect(notesOf([typed("Do it"), reply])).toMatchObject([
      { kind: "note", row: reply.parts[0]?.metadata.id, side: "left" },
    ]);
  });

  it("puts a wake's note on the right, beside the reply it caused", () => {
    const wake = message("user", (id) => [dateNote(id)]);
    const reply = message("assistant", (id) => [said(id, "Back again.")]);
    expect(
      notesOf([
        typed("Do it"),
        message("assistant", (id) => [said(id, "Done.")]),
        wake,
        reply,
      ]),
    ).toMatchObject([{ row: reply.parts[0]?.metadata.id, side: "right" }]);
  });

  it("says which fold a note goes into with its row", () => {
    const opener = typed("Do it");
    const reply = message("assistant", (id) => [
      called(id, "Looking"),
      cleared(id),
      said(id, "Done."),
    ]);
    expect(notesOf([opener, reply])).toMatchObject([{ foldedIn: opener.id }]);
  });

  it("turns a retried attempt's words and error into notes, and leaves the rows alone", () => {
    const failed = message("assistant", (id) => [said(id, "Half a rep")], {
      error: { classification: "rate-limit", kind: "unknown", message: "Busy" },
    });
    const retry = message("assistant", (id) => [said(id, "A whole reply.")]);
    const session = [typed("Do it"), failed, retry];
    const notes = notesOf(session);
    expect(notes.map((note) => note.kind)).toEqual(["replaced", "error"]);
    expect(
      notes.every((note) => note.row === retry.parts[0]?.metadata.id),
    ).toBe(true);
    const light = session.flatMap((one) => transcriptMessage(one) ?? []);
    const [turn] = turnsOf(light, { isRunning: false });
    expect(turn?.rows.map((row) => row.kind)).toEqual(["text"]);
  });

  it("leaves out a thought with no words", () => {
    const reply = message("assistant", (id) => [
      thought(id, "[REDACTED]"),
      said(id, "Done."),
    ]);
    expect(notesOf([typed("Do it"), reply])).toEqual([]);
  });

  it("carries a note with no row to the next turn's", () => {
    const orphan = message("user", (id) => [dateNote(id)]);
    const next = typed("Hello");
    expect(notesOf([orphan, next])).toMatchObject([
      { row: `message:${next.id}` },
    ]);
  });
});
