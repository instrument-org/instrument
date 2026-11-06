import { describe, expect, it } from "vitest";

import { SessionMessage } from "../../schemas/session/message";
import { SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { DATA_PART_SAMPLES } from "./developer-note-samples";
import {
  type DeveloperNote,
  developerNotes,
  developerNotesWithBodies,
} from "./developer-notes";
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
const requestNote = (
  id: StoreId.Message,
  kind: SessionMessageDataPart.RequestNoteDataPart["kind"],
) =>
  ({
    data: { kind, text: "Sample words." },
    metadata: meta(id),
    type: "data-requestNote",
  }) as SessionMessagePart.Type;
const requestFailure = (id: StoreId.Message) =>
  ({
    data: { error: "It failed." },
    metadata: meta(id),
    type: "data-requestFailure",
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

  it("puts a thought beside what came before it, on the left", () => {
    const sent = typed("Do it");
    const reply = message("assistant", (id) => [
      thought(id, "Let me look."),
      called(id, "Looking"),
      thought(id, "Now the other."),
      called(id, "Checking"),
      said(id, "Done."),
    ]);
    expect(notesOf([sent, reply])).toMatchObject([
      {
        kind: "thought",
        row: `message:${sent.id}`,
        rowKind: "bubble",
        side: "left",
      },
      {
        kind: "thought",
        row: reply.parts[1]?.metadata.id,
        rowKind: "activity",
        side: "left",
      },
    ]);
  });

  it("puts what a request went out with beside what came before it", () => {
    const sent = typed("Do it");
    const reply = message("assistant", (id) => [
      requestNote(id, "turn"),
      called(id, "Looking"),
      requestNote(id, "budget"),
      called(id, "Checking"),
      said(id, "Done."),
    ]);
    expect(notesOf([sent, reply])).toMatchObject([
      { label: "Turn note", row: `message:${sent.id}`, side: "right" },
      {
        label: "Budget notice",
        row: reply.parts[1]?.metadata.id,
        side: "left",
      },
    ]);
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

  it("puts a wake's note on the right, beside the row before the wake", () => {
    const before = message("assistant", (id) => [said(id, "Done.")]);
    const wake = message("user", (id) => [dateNote(id)]);
    const reply = message("assistant", (id) => [said(id, "Back again.")]);
    expect(notesOf([typed("Do it"), before, wake, reply])).toMatchObject([
      { row: before.parts[0]?.metadata.id, side: "right" },
    ]);
  });

  it("puts a wake's note on the message when the turn has no row yet", () => {
    const sent = typed("Do it");
    const wake = message("user", (id) => [dateNote(id)]);
    const reply = message("assistant", (id) => [said(id, "Back again.")]);
    expect(notesOf([sent, wake, reply])).toMatchObject([
      { row: `message:${sent.id}`, side: "right" },
    ]);
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
    expect(notes.map((note) => note.row)).toEqual([
      `message:${session[0]?.id ?? ""}`,
      `message:${session[0]?.id ?? ""}`,
    ]);
    expect(new Set(notes.map((note) => note.side))).toEqual(new Set(["left"]));
    const light = session.flatMap((one) => transcriptMessage(one) ?? []);
    const [turn] = turnsOf(light, { isRunning: false });
    expect(turn?.rows.map((row) => row.kind)).toEqual(["text"]);
  });

  it("names a thought's kind and leaves its words to the card", () => {
    const reply = message("assistant", (id) => [
      thought(id, "Let me look."),
      said(id, "Done."),
    ]);
    const { bodies, notes } = developerNotesWithBodies(
      [typed("Do it"), reply],
      { sessionId },
    );
    expect(notes).toMatchObject([{ label: "Thought", mark: "thought" }]);
    expect(bodies.get(notes[0]?.id ?? "")?.text).toBe("Let me look.");
  });

  it("leaves out a thought with no words", () => {
    const reply = message("assistant", (id) => [
      thought(id, "[REDACTED]"),
      said(id, "Done."),
    ]);
    expect(notesOf([typed("Do it"), reply])).toEqual([]);
  });

  it("shows a note's card as the words the request's own walk put on the turn", () => {
    const sent = message("user", (id) => [said(id, "Hi"), dateNote(id)]);
    const heard = SessionMessage.toUIMessages([sent]).flatMap((one) =>
      one.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])),
    );
    const { bodies, notes } = developerNotesWithBodies([sent], { sessionId });
    const body = bodies.get(notes[0]?.id ?? "");
    expect(body?.wasSent).toBe(true);
    expect(heard).toContain(body?.text);
  });

  it("keeps a carried note where it was recorded, and its card says when it went out", () => {
    const stoppedAt = message("assistant", (id) => [
      said(id, "So far."),
      {
        data: { maxStepCount: 25 },
        metadata: meta(id),
        type: "data-maxSteps",
      } as SessionMessagePart.Type,
    ]);
    const session = [typed("Do it"), stoppedAt, typed("Keep going")];
    const place = { row: stoppedAt.parts[0]?.metadata.id, side: "left" };

    const { bodies: waiting, notes: unsent } = developerNotesWithBodies(
      session.slice(0, 2),
      { sessionId },
    );
    expect(unsent).toMatchObject([place]);
    expect(waiting.get(unsent[0]?.id ?? "")?.wasSent).toBe(false);

    const { bodies, notes } = developerNotesWithBodies(session, { sessionId });
    expect(notes).toMatchObject([place]);
    expect(bodies.get(notes[0]?.id ?? "")?.wasSent).toBe(true);
  });

  it("calls a skill the turn wrote what it is, with one note and no second for the words", () => {
    const part = (id: StoreId.Message) =>
      ({
        data: DATA_PART_SAMPLES.setupChanges,
        metadata: meta(id),
        type: "data-setupChanges",
      }) as SessionMessagePart.Type;
    const wrote = message("assistant", (id) => [
      said(id, "Made it."),
      part(id),
    ]);
    const wroteAgain = message("assistant", (id) => [
      said(id, "Changed it."),
      part(id),
    ]);
    const session = [typed("Do it"), wrote, wroteAgain, typed("Thanks")];
    const { bodies, notes } = developerNotesWithBodies(session, { sessionId });
    expect(notes.map((note) => note.label)).toEqual([
      "Setup changed: launch",
      "Setup changed: launch",
    ]);
    const heard = SessionMessage.toUIMessages(session).flatMap((one) =>
      one.parts.flatMap((each) => (each.type === "text" ? [each.text] : [])),
    );
    for (const note of notes) {
      const body = bodies.get(note.id);
      expect(body?.wasSent).toBe(true);
      expect(heard).toContain(body?.text);
    }
  });

  it("calls what dictated words add Dictation, on the message they came on", () => {
    const sent = typed("[Compare these](dictated:)");
    expect(notesOf([sent])).toMatchObject([
      {
        label: "Dictation",
        mark: "dictation",
        row: `message:${sent.id}`,
        side: "right",
      },
    ]);
  });

  it("says a part that never reached the model wasn't sent", () => {
    const reply = message("assistant", (id) => [
      called(id, "Looking"),
      cleared(id),
      said(id, "Done."),
    ]);
    const { bodies, notes } = developerNotesWithBodies(
      [typed("Do it"), reply],
      { sessionId },
    );
    expect(bodies.get(notes[0]?.id ?? "")).toMatchObject({ wasSent: false });
  });

  it("leaves out a picture that repeats what the last one said", () => {
    const project = (id: StoreId.Message) =>
      ({
        data: { project: { name: "Pricing" } },
        metadata: meta(id),
        type: "data-project",
      }) as SessionMessagePart.Type;
    const first = message("user", (id) => [said(id, "One"), project(id)]);
    const second = message("user", (id) => [said(id, "Two"), project(id)]);
    expect(notesOf([first, second])).toMatchObject([
      { label: "Project: Pricing", row: `message:${first.id}` },
    ]);
  });

  it("draws no note in a first turn that opens on a wake until it has a row", () => {
    const reply = message("assistant", (id) => [
      said(id, "Back again."),
      cleared(id),
    ]);
    const session = [
      message("user", (id) => [dateNote(id)]),
      reply,
      typed("Hello"),
    ];
    expect(notesOf(session)).toMatchObject([
      { label: "Tool results cleared: 3", row: reply.parts[0]?.metadata.id },
    ]);
  });
});

/** A part on its way in, ending as it was stored. */
function arrivals(part: SessionMessagePart.Type): SessionMessagePart.Type[] {
  if (part.type === "text" || part.type === "reasoning") {
    return [
      { ...part, state: "streaming", text: "" },
      { ...part, state: "streaming", text: part.text.slice(0, 2) },
      part,
    ];
  }
  if (part.type.startsWith("tool-")) {
    const { input, metadata, toolCallId, type } = part as unknown as Record<
      string,
      unknown
    >;
    return [
      { input: {}, metadata, state: "input-streaming", toolCallId, type },
      { input, metadata, state: "input-available", toolCallId, type },
      part,
    ] as unknown as SessionMessagePart.Type[];
  }
  return [part];
}

/**
 * A session at every point on its way to these messages: a user message lands
 * whole, and an assistant's arrives empty, then a part at a time, and how it
 * ended comes last.
 */
function stagesOf(
  session: readonly SessionMessage.WithParts[],
): SessionMessage.WithParts[][] {
  return session.flatMap((one, at) => {
    const before = session.slice(0, at);
    if (one.role === "user") {
      return [[...before, one]];
    }
    const { error: _ended, ...metadata } = one.metadata as Record<
      string,
      unknown
    >;
    const going = { ...one, metadata } as SessionMessage.WithParts;
    return [
      [...before, { ...going, parts: [] }],
      ...one.parts.flatMap((part, count) =>
        arrivals(part).map((arriving) => [
          ...before,
          { ...going, parts: [...one.parts.slice(0, count), arriving] },
        ]),
      ),
      [...before, one],
    ];
  });
}

/** How many notes the stages come to, and any that sat somewhere else later on. */
function placesAsItGrows(session: readonly SessionMessage.WithParts[]) {
  const places = new Map<string, Pick<DeveloperNote, "row" | "side">>();
  const moved: string[] = [];
  for (const stage of stagesOf(session)) {
    for (const { id, label, row, side } of notesOf(stage)) {
      const place = places.get(id);
      if (!place) {
        places.set(id, { row, side });
      } else if (place.row !== row || place.side !== side) {
        moved.push(label);
      }
    }
  }
  return { moved, placed: places.size };
}

describe("a note stays where it went out", () => {
  const NAMES = SessionMessageDataPart.NameSchema.options;
  const sample = (name: (typeof NAMES)[number]) => (id: StoreId.Message) =>
    ({
      data: DATA_PART_SAMPLES[name],
      metadata: meta(id),
      type: `data-${name}`,
    }) as SessionMessagePart.Type;

  it.each(NAMES)("as a turn grows around a %s part", (name) => {
    const part = sample(name);
    const { moved } = placesAsItGrows([
      message("user", (id) => [said(id, "Do it"), part(id)]),
      message("assistant", (id) => [
        requestNote(id, "turn"),
        thought(id, "Let me look."),
        called(id, "Looking"),
        part(id),
        thought(id, "Now the other."),
        called(id, "Checking"),
        said(id, "Found it."),
      ]),
      message("user", (id) => [part(id)]),
      message("assistant", (id) => [
        thought(id, "Once more."),
        called(id, "Looking again"),
        said(id, "Done."),
      ]),
      message("user", (id) => [said(id, "Next"), part(id)]),
      message("assistant", (id) => [said(id, "Sure.")]),
    ]);
    expect(moved).toEqual([]);
  });

  it.each([
    "budget",
    "correction",
    "output-limit",
    "rollover",
    "turn",
  ] as const)(
    "with a %s request note, first in a turn and between its steps",
    (kind) => {
      const { moved, placed } = placesAsItGrows([
        typed("Do it"),
        message("assistant", (id) => [
          requestNote(id, kind),
          called(id, "Looking"),
          requestNote(id, kind),
          called(id, "Checking"),
          said(id, "Done."),
        ]),
      ]);
      expect({ moved, placed }).toEqual({ moved: [], placed: 2 });
    },
  );

  it("with what a stopped attempt and the attempt after it leave behind", () => {
    const { moved, placed } = placesAsItGrows([
      typed("Do it"),
      message("assistant", (id) => [called(id, "Looking")]),
      message("assistant", (id) => [said(id, "Half a rep")], {
        error: { kind: "aborted", reason: "manual" },
      }),
      message("assistant", (id) => [
        requestFailure(id),
        thought(id, "Again."),
        said(id, "A whole reply."),
      ]),
    ]);
    expect({ moved, placed }).toEqual({ moved: [], placed: 3 });
  });

  it("until its own row goes, as a retried attempt's does", () => {
    const sent = typed("Do it");
    const failed = message("assistant", (id) => [said(id, "Half a rep")], {
      error: { classification: "rate-limit", kind: "unknown", message: "Busy" },
    });
    const retry = message("assistant", (id) => [said(id, "A whole reply.")]);
    const errorOf = (session: SessionMessage.WithParts[]) =>
      notesOf(session).find((note) => note.kind === "error");
    expect(errorOf([sent, failed])?.row).toBe(`error-${failed.id}`);
    expect(errorOf([sent, failed, retry])?.row).toBe(`message:${sent.id}`);
  });

  it("at rest, for each kind on a turn with a wake in it", () => {
    const session = [
      message("user", (id) => [said(id, "Do it"), dateNote(id)]),
      message("assistant", (id) => [
        requestNote(id, "turn"),
        thought(id, "Let me look."),
        called(id, "Looking"),
        cleared(id),
        thought(id, "Now the words."),
        said(id, "Waiting on the job."),
        {
          data: { maxStepCount: 25 },
          metadata: meta(id),
          type: "data-maxSteps",
        } as SessionMessagePart.Type,
      ]),
      message("user", (id) => [dateNote(id)]),
      message("assistant", (id) => [
        requestNote(id, "budget"),
        thought(id, "It finished."),
        said(id, "All done."),
      ]),
    ];
    expect(
      notesOf(session).map(
        ({ foldedIn, label, rowKind, side }) =>
          `${side} of ${rowKind}${foldedIn ? ", folded" : ""}: ${label}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "right of bubble: Today's date: Friday",
        "right of bubble: Turn note",
        "left of bubble: Thought",
        "left of activity, folded: Tool results cleared: 3",
        "left of activity, folded: Thought",
        "left of text: Step limit: 25",
        "right of text: Today's date: Friday",
        "left of text: Budget notice",
        "left of text: Thought",
      ]
    `);
  });
});
