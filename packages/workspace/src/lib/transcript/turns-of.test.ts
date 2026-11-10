import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { MID_TURN_NOTE } from "../chat/mid-turn";
import { cardsOf, workCardOf, workCardTurnOf } from "./work-card";
import {
  type TranscriptMessage,
  transcriptMessage,
} from "./transcript-message";
import {
  FOLD_WAIT_MS,
  isTurnFolded,
  type Turn,
  turnsOf,
  type TurnsCache,
  waitsForStep,
} from "./turns-of";

const sessionId = StoreId.newSessionId();
let clock = Date.parse("2026-11-05T12:00:00Z");
const tick = (ms = 1000) => new Date((clock += ms));
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
): TranscriptMessage {
  const id = StoreId.newMessageId();
  const metadata = {
    createdAt: tick(),
    sessionId,
    ...(role === "assistant"
      ? { finishedAt: tick(0), modelId: "m", providerId: "p" }
      : {}),
    ...extra,
  };
  const stored = { id, metadata, parts: build(id), role };
  // A stored message as the store hands it back; only the fields read here.
  const light = transcriptMessage(
    stored as unknown as SessionMessage.WithParts,
  );
  if (!light) {
    throw new Error("Not a transcript message");
  }
  return light;
}

const said = (
  id: StoreId.Message,
  text: string,
  state: "done" | "streaming" = "done",
) =>
  ({
    metadata: meta(id),
    state,
    text,
    type: "text",
  }) as SessionMessagePart.Type;

const typed = (text: string) => message("user", (id) => [said(id, text)]);

/** A sign-in on a call's card, as `connect_app` records it. */
const asked = (slug: string) => ({
  kind: "sign-in",
  name: slug,
  slug,
  state: "asked",
});

function call(
  id: StoreId.Message,
  tool: string,
  input: Record<string, unknown>,
  output: unknown = { state: "success" },
  state:
    | "input-available"
    | "input-streaming"
    | "output-available"
    | "output-error" = "output-available",
): SessionMessagePart.Type {
  const startedAt = tick();
  return {
    input,
    metadata: {
      ...meta(id),
      startedAt,
      ...(state === "output-available" ? { endedAt: tick() } : {}),
    },
    ...(state === "output-available" ? { output } : {}),
    state,
    toolCallId: StoreId.newPartId(),
    type: `tool-${tool}`,
  } as unknown as SessionMessagePart.Type;
}

const shape = (turn: Turn) =>
  turn.rows.map((row) => {
    switch (row.kind) {
      case "activity": {
        return `activity: ${row.title ?? "(unnamed)"} x${row.steps.length.toString()}`;
      }
      case "text": {
        return `text: ${row.part.text}`;
      }
      case "task": {
        return "task";
      }
      default: {
        return row.kind;
      }
    }
  });

describe("turnsOf", () => {
  it("keeps a wake inside the turn it carries on", () => {
    const turns = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          call(id, "web_search", { activity: "Looking", query: "x" }),
        ]),
        message("user", (id) => [
          {
            data: { answer: "allowed", kind: "app", target: "notion" },
            metadata: meta(id),
            type: "data-permissionAnswer",
          } as SessionMessagePart.Type,
        ]),
        message("assistant", (id) => [said(id, "All done.")]),
      ],
      { isRunning: false },
    );
    expect(turns).toHaveLength(1);
    expect(turns.map(shape)).toMatchInlineSnapshot(`
      [
        [
          "activity: Looking x1",
          "note",
          "text: All done.",
        ],
      ]
    `);
  });

  it("gathers calls under the activity that names them, one row per activity", () => {
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          call(
            id,
            "bash",
            { activity: "Reading", command: "ls" },
            { exitCode: 0 },
          ),
          call(
            id,
            "bash",
            { activity: "Reading", command: "pwd" },
            { exitCode: 0 },
          ),
          call(
            id,
            "bash",
            { activity: "Writing", command: "date" },
            { exitCode: 0 },
          ),
          call(id, "bash", { command: "whoami" }, { exitCode: 0 }),
        ]),
      ],
      { isRunning: true },
    );
    expect(turn && shape(turn)).toMatchInlineSnapshot(`
      [
        "activity: Reading x2",
        "activity: Writing x2",
      ]
    `);
  });

  it("does not open a row per keystroke while an activity's name is written", () => {
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          call(
            id,
            "bash",
            { activity: "Checking the page", command: "ls" },
            { exitCode: 0 },
          ),
          call(id, "bash", { activity: "Check" }, undefined, "input-streaming"),
        ]),
      ],
      { isRunning: true },
    );
    expect(turn && shape(turn)).toMatchInlineSnapshot(`
      [
        "activity: Checking the page x2",
      ]
    `);
  });

  it.each([
    [
      "half of another name",
      { activity: "Conn" },
      ["activity: Setting up Linear x2"],
    ],
    [
      "a name the next field has begun after",
      { activity: "Connecting Linear", explanation: "Show" },
      ["activity: Setting up Linear x1", "activity: Connecting Linear x1"],
    ],
    [
      "a whole name that starts the open one's",
      { activity: "Setting up", explanation: "Show" },
      ["activity: Setting up Linear x1", "activity: Setting up x1"],
    ],
  ])("names a row for a call still arriving with %s", (_, input, rows) => {
    const [turn] = turnsOf(
      [
        typed("Connect Linear"),
        message("assistant", (id) => [
          call(
            id,
            "bash",
            { activity: "Setting up Linear", command: "ls" },
            { exitCode: 0 },
          ),
          call(id, "connect_app", input, undefined, "input-streaming"),
        ]),
      ],
      { isRunning: true },
    );
    expect(turn && shape(turn)).toEqual(rows);
  });

  it("leaves a first row unnamed while its name is half written", () => {
    const [turn] = turnsOf(
      [
        typed("Connect Linear"),
        message("assistant", (id) => [
          call(
            id,
            "connect_app",
            { activity: "Conn" },
            undefined,
            "input-streaming",
          ),
        ]),
      ],
      { isRunning: true },
    );
    expect(turn && shape(turn)).toEqual(["activity: (unnamed) x1"]);
  });

  it("ends the activity at a task's card, and starts a new row after it", () => {
    const task = StoreId.newSessionId();
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          call(
            id,
            "bash",
            { activity: "Looking", command: "ls" },
            { exitCode: 0 },
          ),
          call(
            id,
            "bash",
            { activity: "Looking", command: "task new x" },
            { exitCode: 0, handOffs: [{ kind: "created", sessionId: task }] },
          ),
          call(
            id,
            "bash",
            { activity: "Looking", command: "pwd" },
            { exitCode: 0 },
          ),
        ]),
      ],
      { isRunning: true },
    );
    expect(turn && shape(turn)).toMatchInlineSnapshot(`
      [
        "activity: Looking x1",
        "task",
        "activity: Looking x1",
      ]
    `);
  });

  it("draws a card for a send that names its message, and none for one that does not", () => {
    const task = StoreId.newSessionId();
    const delivered = StoreId.newMessageId();
    const sendCall = (handOff: Record<string, string>) =>
      message("assistant", (id) => [
        call(
          id,
          "bash",
          { activity: "Asking the task", command: "task send t1" },
          { exitCode: 0, handOffs: [handOff] },
        ),
      ]);
    const sent = sendCall({
      kind: "sent",
      messageId: delivered,
      sessionId: task,
    });
    const [named] = turnsOf([typed("Check last year too"), sent], {
      isRunning: false,
    });
    const [legacy] = turnsOf(
      [
        typed("Check last year too"),
        sendCall({ kind: "sent", sessionId: task }),
      ],
      { isRunning: false },
    );
    expect(
      named?.rows.map((row) =>
        row.kind === "task"
          ? { from: row.from, id: row.id, sessionId: row.sessionId }
          : row.kind,
      ),
    ).toStrictEqual([
      { from: delivered, id: sent.parts[0]?.metadata.id, sessionId: task },
    ]);
    expect(legacy && shape(legacy)).toStrictEqual([
      "activity: Asking the task x1",
    ]);
  });

  it("folds the work between what the agent said first and the words it ended on", () => {
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          said(id, "On it."),
          call(
            id,
            "bash",
            { activity: "Working", command: "ls" },
            { exitCode: 0 },
          ),
        ]),
        message("assistant", (id) => [
          said(id, "Here it is."),
          said(id, "And more."),
        ]),
      ],
      { isRunning: false },
    );
    expect(turn?.phase).toBe("done");
    expect(turn && shape(turn)).toMatchInlineSnapshot(`
      [
        "text: On it.",
        "activity: Working x1",
        "text: Here it is.",
        "text: And more.",
      ]
    `);
    const folded = turn?.rows.map((row) => turn.foldedRowIds.has(row.id));
    expect(folded).toEqual([false, true, false, false]);
    expect(turn?.foldLineAt).toBe(turn?.rows[1]?.id);
  });

  it("keeps the words after a first thought above the fold, with its line under them", () => {
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          {
            metadata: meta(id),
            state: "done",
            text: "Let me think.",
            type: "reasoning",
          } as SessionMessagePart.Type,
          said(id, "On it."),
          call(id, "bash", { activity: "Working" }, { exitCode: 0 }),
          said(id, "In between."),
          call(id, "bash", { activity: "Checking" }, { exitCode: 0 }),
          said(id, "Here it is."),
        ]),
      ],
      { isRunning: false },
    );
    const folded = turn?.rows.map((row) => turn.foldedRowIds.has(row.id));
    expect(folded).toEqual([false, true, true, true, false]);
    expect(turn?.foldLineAt).toBe(turn?.rows[1]?.id);
  });

  it.each([
    ["while it goes on", "streaming", true],
    ["once it has ended", "done", false],
  ] as const)("draws no row for a thought %s", (_when, state, isRunning) => {
    const messages = [
      typed("Do the thing"),
      message("assistant", (id) => [
        {
          metadata: meta(id),
          state,
          text: "Let me think.",
          type: "reasoning",
        } as SessionMessagePart.Type,
        ...(isRunning ? [] : [said(id, "Here it is.")]),
      ]),
    ];
    const [turn] = turnsOf(messages, { isRunning });
    expect(turn?.rows.filter((row) => row.kind === "activity")).toEqual([]);
    expect(turn?.live?.kind).toBe(isRunning ? "thinking" : undefined);
  });

  it("opens the working line onto the thought going on, until something follows it", () => {
    const thinking = (id: StoreId.Message) =>
      ({
        metadata: meta(id),
        state: "streaming",
        text: "Let me think.",
        type: "reasoning",
      }) as SessionMessagePart.Type;
    const first = message("assistant", (id) => [thinking(id)]);
    const live = (messages: Parameters<typeof turnsOf>[0]) =>
      turnsOf(messages, { isRunning: true })[0]?.live;

    expect(live([typed("Do the thing"), first])).toMatchObject({
      kind: "thinking",
      thought: { tool: "reasoning" },
    });
    expect(
      live([
        typed("Do the thing"),
        message("assistant", (id) => [thinking(id), said(id, "Here it is.")]),
      ]),
    ).not.toHaveProperty("thought");
  });

  it("draws no row for a thought with no words, so Thinking holds until there are some", () => {
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          {
            metadata: meta(id),
            state: "streaming",
            text: "",
            type: "reasoning",
          } as SessionMessagePart.Type,
        ]),
      ],
      { isRunning: true },
    );
    expect(turn?.rows).toEqual([]);
    expect(turn?.live?.kind).toBe("thinking");
  });

  it("leaves a message cut across with nothing done but words as it was said", () => {
    const [cut] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [said(id, "On it.")]),
        typed("Also this"),
      ],
      { isRunning: true },
    );
    expect(cut?.foldedRowIds.size).toBe(0);
    expect(cut?.foldLineAt).toBeUndefined();
  });

  it.each([
    [
      "a turn with no words at the end",
      () =>
        message("assistant", (id) => [
          call(id, "bash", { activity: "Working" }, { exitCode: 0 }),
        ]),
    ],
    [
      "a failed turn",
      () =>
        message(
          "assistant",
          (id) => [
            call(id, "bash", { activity: "Working" }, { exitCode: 0 }),
            said(id, "Partly."),
          ],
          { error: { kind: "provider", message: "Nope" } },
        ),
    ],
  ])("leaves %s open", (_name, reply) => {
    const [turn] = turnsOf([typed("Do the thing"), reply()], {
      isRunning: false,
    });
    expect(turn?.foldedRowIds.size).toBe(0);
    expect(turn && isTurnFolded(turn, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it("keeps a turn that started a task open, and never folds while it works", () => {
    const task = StoreId.newSessionId();
    const messages = [
      typed("Do the thing"),
      message("assistant", (id) => [
        call(
          id,
          "bash",
          { activity: "Looking", command: "ls" },
          { exitCode: 0 },
        ),
        call(
          id,
          "bash",
          { command: "task new" },
          { exitCode: 0, handOffs: [{ kind: "created", sessionId: task }] },
        ),
        said(id, "It's on its way."),
      ]),
    ];
    const [done] = turnsOf(messages, { isRunning: false });
    expect(done?.foldedRowIds.size).toBe(0);
    const [working] = turnsOf(messages, { isRunning: true });
    expect(working?.foldedRowIds.size).toBe(0);
    expect(working?.phase).toBe("working");
  });

  it("puts no Thinking under a task's card, while the step after it draws what it shows", () => {
    const task = StoreId.newSessionId();
    const started = message("assistant", (id) => [
      call(
        id,
        "bash",
        { command: "task new" },
        { exitCode: 0, handOffs: [{ kind: "created", sessionId: task }] },
      ),
    ]);
    const live = (...after: Parameters<typeof turnsOf>[0]) =>
      turnsOf([typed("Do the thing"), started, ...after], {
        isRunning: true,
      })[0]?.live;
    expect(live()).toBeUndefined();
    expect(
      live(
        message("assistant", (id) => [
          {
            metadata: meta(id),
            state: "streaming",
            text: "Let me think.",
            type: "reasoning",
          } as SessionMessagePart.Type,
        ]),
      ),
    ).toBeUndefined();
    expect(
      live(
        message("assistant", (id) => [
          said(id, "It's on its way.", "streaming"),
        ]),
      )?.kind,
    ).toBe("writing");
  });

  it("keeps the card asking how it went out of the rows", () => {
    const card = (data: { outcome?: "dismissed" | "sent" }) =>
      turnsOf(
        [
          typed("Do the thing"),
          message("assistant", (id) => [
            said(id, "Done."),
            { data, metadata: meta(id), type: "data-ratingCard" },
          ]),
        ],
        { isRunning: false },
      )[0];
    const waiting = card({});
    expect(waiting?.ratingCard?.data).toEqual({});
    expect(waiting?.rows.map((row) => row.kind)).toEqual(["text"]);
    expect(card({ outcome: "sent" })?.ratingCard?.data.outcome).toBe("sent");
    expect(card({ outcome: "dismissed" })?.ratingCard).toBeUndefined();
  });

  it("keeps a branch's note on its last copied turn, out of the rows", () => {
    const data = {
      chat: "2026-11-08-pricing-7k3q",
      records: "/records",
      title: "Pricing",
      work: "/work",
    };
    const turns = turnsOf(
      [
        typed("Compare the prices"),
        message("assistant", (id) => [said(id, "Done.")]),
        message("user", (id) => [
          { data, metadata: meta(id), type: "data-branchedFrom" },
        ]),
      ],
      { isRunning: false },
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]?.branchedFrom?.data).toEqual(data);
    expect(turns[0]?.rows.map((row) => row.kind)).toEqual(["text"]);
  });

  it("waits for the summary or the wait, whichever comes first", () => {
    const messages = [
      typed("Do the thing"),
      message("assistant", (id) => [
        call(id, "bash", { activity: "Working" }, { exitCode: 0 }),
        said(id, "Done."),
      ]),
    ];
    const [turn] = turnsOf(messages, { isRunning: false });
    if (!turn?.endedAt) {
      throw new Error("A finished turn has an end");
    }
    const end = turn.endedAt.getTime();
    expect(isTurnFolded(turn, end + FOLD_WAIT_MS - 1)).toBe(false);
    expect(isTurnFolded(turn, end + FOLD_WAIT_MS)).toBe(true);
    expect(isTurnFolded({ ...turn, summary: "Did it" }, end)).toBe(true);
  });

  it("never folds a turn a message cut across", () => {
    const [cut] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          call(id, "bash", { activity: "Finished" }, { exitCode: 0 }),
          call(
            id,
            "bash",
            { activity: "Still going", command: "sleep" },
            undefined,
            "input-available",
          ),
        ]),
        message("user", (id) => [
          said(id, "Also this"),
          {
            data: { text: MID_TURN_NOTE },
            metadata: meta(id),
            type: "data-intent",
          } as SessionMessagePart.Type,
        ]),
      ],
      { isRunning: true },
    );
    if (!cut) {
      throw new Error("Expected the first turn");
    }
    expect(cut.phase).toBe("done");
    expect(cut.foldedRowIds.size).toBe(0);
    expect(isTurnFolded(cut, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it("says a repeated line once", () => {
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [said(id, "Trying.")]),
        message("assistant", (id) => [said(id, "Trying.")]),
        message("assistant", (id) => [said(id, "Trying. And done.")]),
      ],
      { isRunning: false },
    );
    expect(turn && shape(turn)).toMatchInlineSnapshot(`
      [
        "text: Trying.",
        "text: And done.",
      ]
    `);
  });

  it("draws no row for a line while it is still the one before it", () => {
    const last = (words: string) => {
      const [turn] = turnsOf(
        [
          typed("Do the thing"),
          message("assistant", (id) => [said(id, "Trying.")]),
          message("assistant", (id) => [said(id, words, "streaming")]),
        ],
        { isRunning: true },
      );
      return turn && shape(turn);
    };
    expect(last("Try")).toEqual(["text: Trying."]);
    expect(last("Trying.")).toEqual(["text: Trying."]);
    expect(last("Trying. And")).toEqual(["text: Trying.", "text: And"]);
    expect(last("Trial")).toEqual(["text: Trying.", "text: Trial"]);
  });

  it("keeps the turn of a slice whose messages have not changed", () => {
    const first = [
      typed("One"),
      message("assistant", (id) => [said(id, "Done.")]),
    ];
    const cache: TurnsCache = new Map();
    const before = turnsOf(first, { isRunning: false }, cache);
    const second = typed("Two");
    const after = turnsOf([...first, second], { isRunning: true }, cache);
    expect(after[0]).toBe(before[0]);
    expect(after).toHaveLength(2);
    const again = turnsOf([...first, second], { isRunning: true }, cache);
    expect(again[1]).toBe(after[1]);
  });
});

describe("the work card", () => {
  const cardKinds = (turn: Turn | undefined) =>
    (turn?.rows ?? []).flatMap((row) =>
      row.kind === "activity"
        ? cardsOf(row).map(
            (card) => `${card.kind} x${card.steps.length.toString()}`,
          )
        : [],
    );

  it("gives a run of one kind one card, and a file a card of its own", () => {
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          call(id, "write_file", {
            activity: "Writing",
            content: "a",
            filePath: "/a.md",
          }),
          call(id, "write_file", {
            activity: "Writing",
            content: "b",
            filePath: "/b.md",
          }),
          call(
            id,
            "bash",
            { activity: "Checking", command: "ls" },
            { exitCode: 0 },
          ),
          call(id, "edit_file", {
            activity: "Fixing",
            filePath: "/a.md",
            newString: "y",
            oldString: "x",
          }),
          call(
            id,
            "web_search",
            { activity: "Looking", query: "cats" },
            {
              results: {
                kind: "excerpts",
                sources: [{ title: "Cats", url: "https://cats.example" }],
              },
              state: "success",
            },
          ),
          call(
            id,
            "web_fetch",
            { activity: "Looking", url: "https://cats.example" },
            { state: "success", text: "# Cats\n\nThey purr." },
          ),
          call(
            id,
            "bash",
            { activity: "Browsing", command: "agent-browser click @e1" },
            { exitCode: 0 },
          ),
        ]),
      ],
      { isRunning: true },
    );
    expect(cardKinds(turn)).toMatchInlineSnapshot(`
      [
        "files x1",
        "files x1",
        "files x1",
        "web x2",
        "page x1",
      ]
    `);
    expect(turn && workCardOf(turn)?.kind).toBe("page");
  });

  it("keeps the words of a reply that was stopped", () => {
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [said(id, "Halfway through")], {
          error: { kind: "aborted" },
        }),
      ],
      { isRunning: false },
    );
    expect(turn?.rows.map((row) => row.kind)).toEqual(["text"]);
  });

  it("keeps the same words after a wake", () => {
    const wake = message("user", (id) => [
      {
        data: { events: [] },
        metadata: meta(id),
        type: "data-taskEvent",
      } as SessionMessagePart.Type,
    ]);
    const turns = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [said(id, "Done.")]),
        wake,
        message("assistant", (id) => [said(id, "Done.")]),
      ],
      { isRunning: false },
    );
    expect(
      turns.flatMap((turn) => turn.rows.filter((row) => row.kind === "text")),
    ).toHaveLength(2);
  });

  it("carries a wake after the answer on in a turn of its own, and keeps one while the agent works", () => {
    const wake = () =>
      message("user", (id) => [
        {
          data: { events: [] },
          metadata: meta(id),
          type: "data-taskEvent",
        } as SessionMessagePart.Type,
      ]);
    const answered = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          call(id, "bash", { activity: "Working" }, { exitCode: 0 }),
          said(id, "I've started on it."),
        ]),
        wake(),
        message("assistant", (id) => [said(id, "It's done.")]),
      ],
      { isRunning: false },
    );
    expect(
      answered.map((turn) => ({
        opener: turn.opener !== undefined,
        rows: turn.rows.map((row) => row.kind),
      })),
    ).toEqual([
      { opener: true, rows: ["activity", "text"] },
      { opener: false, rows: ["text"] },
    ]);
    expect(answered[0]?.foldedRowIds.size).toBe(1);
    expect(answered[1]?.wokenBy).toBeUndefined();
    const finished = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [said(id, "I've started on it.")]),
        message("user", (id) => [
          {
            data: {
              events: [
                {
                  sessionId: StoreId.newSessionId(),
                  status: "done",
                  summary: "Done.",
                  title: "The thing",
                },
              ],
            },
            metadata: meta(id),
            type: "data-taskEvent",
          } as SessionMessagePart.Type,
        ]),
        message("assistant", (id) => [said(id, "It's done.")]),
      ],
      { isRunning: false },
    );
    expect(finished[1]?.wokenBy).toEqual({ count: 1, kind: "task-finished" });
    const working = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          call(id, "bash", { activity: "Working" }, { exitCode: 0 }),
        ]),
        wake(),
        message("assistant", (id) => [said(id, "It's done.")]),
      ],
      { isRunning: false },
    );
    expect(working).toHaveLength(1);
  });

  it("gives each task a call started its own row", () => {
    const [one, two] = [StoreId.newSessionId(), StoreId.newSessionId()];
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          call(
            id,
            "bash",
            { command: "task new" },
            {
              exitCode: 0,
              handOffs: [
                { kind: "created", sessionId: one },
                { kind: "created", sessionId: two },
              ],
            },
          ),
        ]),
      ],
      { isRunning: true },
    );
    expect(new Set(turn?.rows.map((row) => row.id)).size).toBe(2);
  });

  it("tells an old error it is no longer the last message", () => {
    const cache: TurnsCache = new Map();
    const failed = [
      typed("Do the thing"),
      message("assistant", () => [], { error: { kind: "provider" } }),
    ];
    const lastness = (turn: Turn | undefined) =>
      turn?.rows.find((row) => row.kind === "error")?.isLastMessage;
    expect(lastness(turnsOf(failed, { isRunning: false }, cache)[0])).toBe(
      true,
    );
    expect(
      lastness(
        turnsOf([...failed, typed("Again")], { isRunning: true }, cache)[0],
      ),
    ).toBe(false);
  });

  it.each([
    [
      "a question not answered",
      "choose",
      { questions: [] },
      undefined,
      "input-available",
    ],
    [
      "a question up on its card, not answered",
      "choose",
      { questions: [] },
      { asked: true },
      "output-available",
    ],
    [
      "a sign-in nothing has settled",
      "connect_app",
      { apps: ["notion"] },
      asked("notion"),
      "output-available",
    ],
  ] as const)(
    "keeps the whole turn open for %s",
    (_name, tool, input, output, state) => {
      const [turn] = turnsOf(
        [
          typed("Do the thing"),
          message("assistant", (id) => [
            call(id, "bash", { activity: "Working" }, { exitCode: 0 }),
            call(id, tool, input, output, state),
            said(id, "Waiting on you."),
          ]),
        ],
        { isRunning: false },
      );
      expect(turn?.rows.find((row) => row.kind === "ask")).toMatchObject({
        isOpen: true,
      });
      expect(turn?.foldedRowIds.size).toBe(0);
    },
  );

  it.each([
    ["a task started before any step", "task"],
    ["a note before any step", "note"],
  ] as const)("keeps the whole turn open for %s", (_name, first) => {
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          first === "task"
            ? call(
                id,
                "bash",
                { command: "task new" },
                {
                  exitCode: 0,
                  handOffs: [
                    { kind: "created", sessionId: StoreId.newSessionId() },
                  ],
                },
              )
            : ({
                data: { answer: "allowed", kind: "app", target: "notion" },
                metadata: meta(id),
                type: "data-permissionAnswer",
              } as SessionMessagePart.Type),
          call(id, "bash", { activity: "Looking" }, { exitCode: 0 }),
          said(id, "Done."),
        ]),
      ],
      { isRunning: false },
    );
    expect(turn?.foldedRowIds.size).toBe(0);
  });

  it.each([
    ["under the reply", "after", 1],
    ["between the last step and the reply", "before", 0],
  ] as const)(
    "with a note %s, %s the reply, folds %i row(s)",
    (_name, where, folded) => {
      const note = (id: StoreId.Message) =>
        ({
          data: {
            changes: [{ change: "added", kind: "memory", name: "no-stevia" }],
          },
          metadata: meta(id),
          type: "data-setupChanges",
        }) as SessionMessagePart.Type;
      const [turn] = turnsOf(
        [
          typed("Do the thing"),
          message("assistant", (id) => [
            call(id, "bash", { activity: "Looking" }, { exitCode: 0 }),
            ...(where === "before" ? [note(id)] : []),
            said(id, "Done."),
            ...(where === "after" ? [note(id)] : []),
          ]),
        ],
        { isRunning: false },
      );
      expect(turn?.rows.some((row) => row.kind === "note")).toBe(true);
      expect(turn?.foldedRowIds.size).toBe(folded);
    },
  );

  it("folds a turn whose question the person wrote past without answering", () => {
    const cache: TurnsCache = new Map();
    const question = [
      typed("Plan the trip"),
      message("assistant", (id) => [
        call(id, "bash", { activity: "Looking" }, { exitCode: 0 }),
        call(
          id,
          "choose",
          { questions: [] },
          { asked: true },
          "output-available",
        ),
        said(id, "Two questions for you above."),
      ]),
    ];
    expect(
      turnsOf(question, { isRunning: false }, cache)[0]?.foldedRowIds.size,
    ).toBe(0);
    expect(
      turnsOf(
        [...question, typed("Actually, never mind")],
        { isRunning: false },
        cache,
      )[0]?.foldedRowIds.size,
    ).toBe(2);
  });

  it("keeps a question open through a task's wake until its answer is on the call, then folds the turn", () => {
    const turn = (output: unknown) =>
      turnsOf(
        [
          typed("Plan the trip"),
          message("assistant", (id) => [
            call(id, "bash", { activity: "Looking" }, { exitCode: 0 }),
            call(id, "choose", { questions: [] }, output, "output-available"),
          ]),
          message("user", (id) => [
            {
              data: { events: [] },
              metadata: meta(id),
              type: "data-taskEvent",
            } as SessionMessagePart.Type,
          ]),
          message("assistant", (id) => [said(id, "The flights are in.")]),
        ],
        { isRunning: false },
      )[0];
    expect(turn({ asked: true })?.foldedRowIds.size).toBe(0);
    expect(
      turn({
        answer: { replies: [{ picked: ["Friday"] }] },
        asked: true,
      })?.foldedRowIds.size,
    ).toBe(2);
  });

  it.each([
    ["connecting", ["notion"], [["connected", "notion"]], true],
    ["being declined", ["notion"], [["declined", "notion"]], true],
    ["the app going", ["notion"], [["removed", "notion"]], true],
    ["a failure, to try again", ["notion"], [["failed", "notion"]], false],
    [
      "a retry that worked",
      ["notion"],
      [
        ["failed", "notion"],
        ["connected", "notion"],
      ],
      true,
    ],
    ["another app's news", ["notion"], [["connected", "linear"]], false],
    ["one app of two", ["notion", "linear"], [["connected", "notion"]], false],
    [
      "both apps of two",
      ["notion", "linear"],
      [
        ["connected", "notion"],
        ["declined", "linear"],
      ],
      true,
    ],
  ])("folds a sign-in or not after %s", (_name, apps, events, folds) => {
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          call(
            id,
            "connect_app",
            { apps },
            { apps: apps.map((app) => asked(app)) },
          ),
        ]),
        ...events.map(([event, slug]) =>
          message("user", (id) => [
            {
              data: {
                apps: [],
                events: [{ event, name: slug, slug }],
              },
              metadata: meta(id),
              type: "data-appEvent",
            } as unknown as SessionMessagePart.Type,
          ]),
        ),
        message("assistant", (id) => [said(id, "Here's where that got to.")]),
      ],
      { isRunning: false },
    );
    const ask = turn?.rows.find((row) => row.kind === "ask");
    expect(ask && turn?.foldedRowIds.has(ask.id)).toBe(folds);
  });

  it("shows nothing for a call that failed", () => {
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          call(
            id,
            "write_file",
            { content: "", filePath: "notes.md" },
            undefined,
            "output-error",
          ),
        ]),
      ],
      { isRunning: true },
    );
    expect(turn && workCardOf(turn)).toBeUndefined();
  });

  it.each([true, false])(
    "says whether a written file is new (%s), once the call has said",
    (isNewFile) => {
      const [turn] = turnsOf(
        [
          typed("Do the thing"),
          message("assistant", (id) => [
            call(
              id,
              "write_file",
              { content: "a", filePath: "/a.md" },
              { filePath: "/a.md", isNewFile },
            ),
          ]),
        ],
        { isRunning: true },
      );
      const shows = turn && workCardOf(turn)?.steps.at(-1)?.shows;
      expect(shows?.kind === "file" && shows.isNew).toBe(isNewFile);
    },
  );

  it.each([
    ["a short file whole", "# Title\nfirst", "# Title\nfirst"],
    [
      "the end of a long one from its first whole line",
      `${"x".repeat(2000)}\nlast line`,
      "last line",
    ],
  ])("shows %s as it is written", (_, content, words) => {
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          call(
            id,
            "write_file",
            { content, filePath: "/a.md" },
            undefined,
            "input-streaming",
          ),
        ]),
      ],
      { isRunning: true },
    );
    const shows = turn && workCardOf(turn)?.steps.at(-1)?.shows;
    expect(shows?.kind === "file" && shows.words).toBe(words);
  });

  it("ends the card at what the agent says after the work, working or ended, and puts one up again at the next call", () => {
    const searched = (id: Parameters<typeof call>[0]) =>
      call(id, "web_search", { activity: "Looking", query: "x" }, {});
    const spoke = [
      typed("Do the thing"),
      message("assistant", (id) => [searched(id), said(id, "Found it.")]),
    ];
    const [searching] = turnsOf(
      [typed("Do the thing"), message("assistant", (id) => [searched(id)])],
      { isRunning: true },
    );
    expect(searching && workCardOf(searching)?.kind).toBe("web");
    const [speaking] = turnsOf(spoke, { isRunning: true });
    expect(speaking && workCardOf(speaking)).toBeUndefined();
    const [ended] = turnsOf(spoke, { isRunning: false });
    expect(ended && workCardOf(ended)).toBeUndefined();
    const [movedOn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          searched(id),
          said(id, "Found it."),
          call(
            id,
            "write_file",
            { activity: "Writing", content: "a", filePath: "/a.md" },
            undefined,
            "input-available",
          ),
        ]),
      ],
      { isRunning: true },
    );
    expect(movedOn && workCardOf(movedOn)?.kind).toBe("files");
  });

  it("draws a task's card from its call as it arrives, under the call's id once the task exists", () => {
    const task = StoreId.newSessionId();
    const step = StoreId.newPartId();
    const startedBy = (
      output: Record<string, unknown> | undefined,
      state?: SessionMessagePart.ToolPart["state"],
    ) =>
      message("assistant", (id) => {
        const bash = call(
          id,
          "bash",
          {
            activity: "Starting a task",
            command: "instrument task new --name 'Price check' <<'EOF'",
          },
          output,
          state,
        );
        return [
          { ...bash, metadata: { ...bash.metadata, id: step } },
        ] as SessionMessagePart.Type[];
      });
    const rowsAt = (
      output: Record<string, unknown> | undefined,
      state?: SessionMessagePart.ToolPart["state"],
    ) =>
      turnsOf([typed("Check prices"), startedBy(output, state)], {
        isRunning: true,
      })[0]?.rows.map((row) =>
        row.kind === "task"
          ? { id: row.id, name: row.name, sessionId: row.sessionId }
          : row.kind,
      );
    expect(rowsAt(undefined, "input-streaming")).toStrictEqual([
      { id: step, name: "Price check", sessionId: undefined },
    ]);
    expect(
      rowsAt({ exitCode: 0, handOffs: [{ kind: "created", sessionId: task }] }),
    ).toStrictEqual([{ id: step, name: undefined, sessionId: task }]);
    expect(rowsAt({ exitCode: 1 })).toStrictEqual(["activity"]);
  });

  it("gives way to a card asking the person", () => {
    const turn = (output: unknown) =>
      turnsOf(
        [
          typed("Tidy my phone"),
          message("assistant", (id) => [
            call(
              id,
              "write_file",
              { activity: "Writing", content: "a", filePath: "/a.md" },
              { filePath: "/a.md", isNewFile: true },
            ),
            call(id, "choose", { questions: [] }, output, "output-available"),
          ]),
        ],
        { isRunning: false },
      )[0];
    const waiting = turn({ asked: true });
    expect(waiting && workCardOf(waiting)).toBeUndefined();
    expect(waiting && workCardTurnOf([waiting])).toBeUndefined();
  });

  it.each([
    [
      "a permission card",
      "ask_permission",
      { kind: "folder", state: "asked", target: "/b" },
    ],
    ["a card a command put up", "bash", { asks: ["ask"], exitCode: 1 }],
  ])("gives way to %s the turn ended on", (_, tool, output) => {
    const turn = (stepOutput: unknown) =>
      turnsOf(
        [
          typed("Tidy my phone"),
          message("assistant", (id) => [
            call(
              id,
              "write_file",
              { activity: "Writing", content: "a", filePath: "/a.md" },
              { filePath: "/a.md", isNewFile: true },
            ),
            call(id, tool, { activity: "Writing" }, stepOutput),
          ]),
        ],
        { isRunning: false },
      )[0];
    const waiting = turn(output);
    expect(waiting && workCardOf(waiting)).toBeUndefined();
    const ran = turn({ exitCode: 0, state: "allowed", target: "/b" });
    expect(ran && workCardOf(ran)?.kind).toBe("files");
  });

  it("gives way to a task's card, which carries its own", () => {
    const task = StoreId.newSessionId();
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          call(id, "web_search", { activity: "Looking", query: "x" }),
          call(
            id,
            "bash",
            { command: "task new" },
            { exitCode: 0, handOffs: [{ kind: "created", sessionId: task }] },
          ),
        ]),
      ],
      { isRunning: true },
    );
    expect(turn && workCardOf(turn)).toBeUndefined();
  });

  it("keeps one card up across a message sent mid-turn", () => {
    const wrote = (id: Parameters<typeof call>[0], filePath: string) =>
      call(id, "write_file", { activity: "Writing", content: "a", filePath });
    const midTurn = message("user", (id) => [
      said(id, "Also this"),
      {
        data: { text: MID_TURN_NOTE },
        metadata: meta(id),
        type: "data-intent",
      } as SessionMessagePart.Type,
    ]);
    const before = [
      typed("Do the thing"),
      message("assistant", (id) => [wrote(id, "/a.md")]),
      midTurn,
    ];
    const cardIn = (after: Parameters<typeof turnsOf>[0]) => {
      const turns = turnsOf([...before, ...after], { isRunning: true });
      return turns.findIndex((turn) => turn.id === workCardTurnOf(turns));
    };
    expect(cardIn([])).toBe(0);
    expect(cardIn([message("assistant", (id) => [wrote(id, "/b.md")])])).toBe(
      1,
    );
    // Words in the turn still working end the card.
    expect(cardIn([message("assistant", (id) => [said(id, "On it.")])])).toBe(
      -1,
    );
  });

  it("says a message is waiting while a step goes on above it", () => {
    const working = message("assistant", (id) => [
      call(id, "bash", { command: "sleep 9" }, undefined, "input-available"),
    ]);
    const waiting = turnsOf([typed("One"), working, typed("Also this")], {
      isRunning: true,
    });
    expect(waitsForStep(waiting)).toBe(true);
    expect(waiting[0]?.live?.kind).toBe("activity");
    const finished = message("assistant", (id) => [
      call(id, "bash", { command: "sleep 9" }, { exitCode: 0 }),
    ]);
    expect(
      waitsForStep(
        turnsOf([typed("One"), finished, typed("Also this")], {
          isRunning: true,
        }),
      ),
    ).toBe(false);
  });

  it("stays the working line between an activity's calls", () => {
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          call(id, "bash", { activity: "Browsing" }, { exitCode: 0 }),
        ]),
      ],
      { isRunning: true },
    );
    expect(turn?.live?.kind).toBe("activity");
  });

  it.each(["", "  \n", "```", "```\n```", "~~~"])(
    "draws no row for a reply of only %j",
    (text) => {
      const [turn] = turnsOf(
        [typed("Do the thing"), message("assistant", (id) => [said(id, text)])],
        { isRunning: false },
      );
      expect(turn?.rows).toEqual([]);
    },
  );

  describe("between activities", () => {
    const browsed = (id: Parameters<typeof call>[0]) =>
      call(
        id,
        "bash",
        { activity: "Browsing", command: "agent-browser open a.example" },
        { exitCode: 0 },
      );
    const addingUp = (id: Parameters<typeof call>[0], activity = "Adding up") =>
      call(
        id,
        "bash",
        { activity, command: "sleep 5" },
        undefined,
        "input-available",
      );
    const cardAfter = (
      ...parts: ((id: StoreId.Message) => SessionMessagePart.Type)[]
    ) => {
      const [turn] = turnsOf(
        [
          typed("Do the thing"),
          message("assistant", (id) => parts.map((part) => part(id))),
        ],
        { isRunning: true },
      );
      return turn && workCardOf(turn);
    };

    it("keeps the card of the activity before while a new one has nothing to show", () => {
      expect(cardAfter(browsed)?.kind).toBe("page");
      expect(cardAfter(browsed, addingUp)?.kind).toBe("page");
    });

    it("keeps it through several activities with nothing to show", () => {
      expect(
        cardAfter(browsed, addingUp, (id) => addingUp(id, "Checking"))?.kind,
      ).toBe("page");
    });

    it("gives way to the first card the new activity has", () => {
      expect(
        cardAfter(browsed, addingUp, (id) =>
          call(id, "write_file", {
            activity: "Writing",
            content: "a",
            filePath: "/a.md",
          }),
        )?.kind,
      ).toBe("files");
    });

    it("ends at what the agent says between them, until the next activity shows something", () => {
      const spoke = (id: StoreId.Message) => said(id, "Now the next page.");
      expect(cardAfter(browsed, spoke)).toBeUndefined();
      expect(cardAfter(browsed, spoke, addingUp)).toBeUndefined();
      expect(cardAfter(browsed, spoke, browsed)?.kind).toBe("page");
    });

    it("goes for a task's card, and doesn't come back for an activity after it", () => {
      const started = (id: StoreId.Message) =>
        call(
          id,
          "bash",
          { command: "task new" },
          {
            exitCode: 0,
            handOffs: [{ kind: "created", sessionId: StoreId.newSessionId() }],
          },
        );
      expect(cardAfter(browsed, started, addingUp)).toBeUndefined();
    });

    it("holds across a wake", () => {
      const [turn] = turnsOf(
        [
          typed("Do the thing"),
          message("assistant", (id) => [browsed(id)]),
          message("user", (id) => [
            {
              data: { date: "2026-11-06" },
              metadata: meta(id),
              type: "data-dateChange",
            } as SessionMessagePart.Type,
          ]),
          message("assistant", (id) => [addingUp(id)]),
        ],
        { isRunning: true },
      );
      expect(turn && workCardOf(turn)?.kind).toBe("page");
    });
  });

  describe("words still arriving with nothing in them", () => {
    const searched = (id: Parameters<typeof call>[0]) =>
      call(id, "web_search", { activity: "Looking", query: "x" }, {});

    it.each(["", "  \n", "```", "~~~"])(
      "leave the card and the working line as they were for %j",
      (text) => {
        const [turn] = turnsOf(
          [
            typed("Do the thing"),
            message("assistant", (id) => [
              searched(id),
              said(id, text, "streaming"),
            ]),
          ],
          { isRunning: true },
        );
        expect(turn && shape(turn)).toEqual(["activity: Looking x1"]);
        expect(turn && workCardOf(turn)?.kind).toBe("web");
        expect(turn?.live?.kind).toBe("activity");
      },
    );

    it("draw no row and leave Thinking up before there is any work", () => {
      const [turn] = turnsOf(
        [
          typed("Do the thing"),
          message("assistant", (id) => [said(id, "", "streaming")]),
        ],
        { isRunning: true },
      );
      expect(turn?.rows).toEqual([]);
      expect(turn?.live?.kind).toBe("thinking");
    });

    it("let the next call join the activity it follows", () => {
      const [turn] = turnsOf(
        [
          typed("Do the thing"),
          message("assistant", (id) => [
            searched(id),
            said(id, "\n", "streaming"),
            searched(id),
          ]),
        ],
        { isRunning: true },
      );
      expect(turn && shape(turn)).toEqual(["activity: Looking x2"]);
    });

    it("give way to the row of the first words, under the same id", () => {
      const going = message("assistant", (id) => [
        searched(id),
        said(id, "Found", "streaming"),
      ]);
      const [turn] = turnsOf([typed("Do the thing"), going], {
        isRunning: true,
      });
      expect(turn && shape(turn)).toEqual([
        "activity: Looking x1",
        "text: Found",
      ]);
      expect(turn?.rows[1]?.id).toBe(going.parts[1]?.metadata.id);
      expect(turn && workCardOf(turn)).toBeUndefined();
      expect(turn?.live?.kind).toBe("writing");
    });
  });

  it("shows a file a command changed, from what the disk told", () => {
    const step = StoreId.newPartId();
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => {
          const bash = call(
            id,
            "bash",
            { activity: "Building", command: "python build.py" },
            { exitCode: 0 },
          );
          return [
            {
              ...bash,
              metadata: { ...bash.metadata, id: step },
            } as SessionMessagePart.Type,
            {
              data: {
                apps: [],
                counts: [{ count: 9, label: "rows added" }],
                files: [
                  { change: "created", path: "/work/report.csv", via: "disk" },
                ],
                hosts: [],
                settled: true,
                step,
              },
              metadata: meta(id),
              type: "data-stepFacts",
            } as SessionMessagePart.Type,
          ];
        }),
      ],
      { isRunning: true },
    );
    const card = turn && workCardOf(turn);
    expect(card?.kind).toBe("files");
    expect(card?.changedFile).toEqual({
      isNew: true,
      path: "/work/report.csv",
    });
    const row = turn?.rows[0];
    expect(row?.kind === "activity" && row.counts).toEqual([
      { count: 9, label: "rows added" },
    ]);
  });

  it("shows no card for a command that changed several files", () => {
    const step = StoreId.newPartId();
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => {
          const bash = call(
            id,
            "bash",
            { activity: "Building", command: "python build.py" },
            { exitCode: 0 },
          );
          return [
            {
              ...bash,
              metadata: { ...bash.metadata, id: step },
            } as SessionMessagePart.Type,
            {
              data: {
                apps: [],
                counts: [],
                files: [
                  { change: "created", path: "/work/a.csv", via: "disk" },
                  { change: "created", path: "/work/b.csv", via: "disk" },
                ],
                hosts: [],
                settled: true,
                step,
              },
              metadata: meta(id),
              type: "data-stepFacts",
            } as SessionMessagePart.Type,
          ];
        }),
      ],
      { isRunning: true },
    );
    expect(turn && workCardOf(turn)).toBeUndefined();
  });
});

describe("what a step carries", () => {
  const stepOf = (
    input: Record<string, unknown>,
    output: unknown,
    tool = "bash",
  ) => {
    const light = message("assistant", (id) => [call(id, tool, input, output)]);
    const [step] = light.parts;
    return step?.type === "step" ? step : undefined;
  };

  it.each([
    ["a nonzero exit", { exitCode: 1 }, "failed"],
    ["a zero exit", { exitCode: 0 }, "done"],
    ["a failure the tool reported", { state: "failure" }, "failed"],
  ])("reads %s as a status", (_name, output, status) => {
    expect(stepOf({ command: "x" }, output)?.status).toBe(status);
  });

  it("leaves out what a call returned", () => {
    const step = stepOf(
      { command: "cat big" },
      { exitCode: 0, output: "x".repeat(10_000) },
    );
    expect(JSON.stringify(step)).not.toContain("xxxx");
  });

  it("starts a fetched page at its first heading, and gives no words without one", () => {
    const shows = (text: string) =>
      stepOf(
        { url: "https://a.example" },
        { state: "success", text },
        "web_fetch",
      )?.shows;
    expect(
      shows("Skip to main\n[Menu](/m)\n# The title\n\nThe [body](/b) words"),
    ).toMatchInlineSnapshot(`
      {
        "kind": "fetch",
        "title": "The title",
        "url": "https://a.example",
        "words": "The body words",
      }
    `);
    expect(shows("Skip to main\nSign in")).toEqual({
      kind: "fetch",
      url: "https://a.example",
    });
    // A page's own title wins over a heading its navigation hides from sight.
    expect(
      stepOf(
        { url: "https://a.example" },
        {
          state: "success",
          text: "## Navigation Menu\n\n# repo\n\nA tool",
          title: "owner/repo: A tool",
        },
        "web_fetch",
      )?.shows,
    ).toMatchObject({ kind: "fetch", title: "owner/repo: A tool" });
  });

  it.each([
    ["agent-browser click @e1", { changesPage: true, kind: "page" }],
    ["agent-browser get title", { changesPage: false, kind: "page" }],
    [
      "agent-browser open https://a.example",
      { changesPage: true, kind: "page", url: "https://a.example" },
    ],
    ["open https://a.example", { kind: "opened", target: "https://a.example" }],
    ["cd work && open report.pdf", { kind: "opened", target: "report.pdf" }],
    ["git commit -m 'open the file'", undefined],
    ["instrument task new --name x 'agent-browser open a.example'", undefined],
    ["echo agent-browser", undefined],
    ["cat > note <<'EOF'\nopen the door\nagent-browser open x\nEOF", undefined],
    ["open -a Preview chart.png", { kind: "opened", target: "chart.png" }],
    ["open the", undefined],
    [
      "instrument window show report.md",
      { kind: "opened", target: "report.md" },
    ],
    ["ls -la", undefined],
  ])("reads what `%s` shows", (command, shows) => {
    expect(stepOf({ command }, { exitCode: 0 })?.shows).toEqual(shows);
  });
});

describe("a failed attempt", () => {
  const failed = () =>
    message(
      "assistant",
      (id) => [
        { metadata: meta(id), type: "step-start" } as SessionMessagePart.Type,
      ],
      {
        error: {
          classification: "transient",
          kind: "provider",
          message: "fetch failed",
        },
      },
    );
  const retry = (words?: string) =>
    message("assistant", (id) => [
      { metadata: meta(id), type: "step-start" } as SessionMessagePart.Type,
      ...(words === undefined ? [] : [said(id, words)]),
    ]);
  const errorRows = (messages: TranscriptMessage[]) =>
    (
      turnsOf([typed("Do the thing"), ...messages], { isRunning: true })[0]
        ?.rows ?? []
    ).flatMap((row) => (row.kind === "error" ? [row.isLatestAttempt] : []));

  it.each([
    ["stands as the last message", () => [failed()], [true]],
    [
      "stands above a retry that has said nothing",
      () => [failed(), retry()],
      [true],
    ],
    ["goes once the retry says something", () => [failed(), retry("Hi")], []],
    [
      "gives way to a retry that failed too",
      () => [failed(), failed()],
      [true],
    ],
    [
      "gives way when two retries are past it",
      () => [failed(), failed(), retry()],
      [true],
    ],
  ])("%s", (_name, messages, expected) => {
    expect(errorRows(messages())).toEqual(expected);
  });
});
