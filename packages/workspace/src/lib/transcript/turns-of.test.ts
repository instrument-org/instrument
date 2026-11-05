import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { MID_TURN_NOTE } from "../chat/mid-turn";
import { cardsOf, isSlotBehind, slotOf } from "./slot";
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

  it("folds everything before the words a turn ended on", () => {
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
    expect(folded).toEqual([true, true, false, false]);
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

  it("never folds a task's card, and never folds while it works", () => {
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
    expect(
      done?.rows
        .filter((row) => done.foldedRowIds.has(row.id))
        .map((row) => row.kind),
    ).toEqual(["activity"]);
    const [working] = turnsOf(messages, { isRunning: true });
    expect(working?.foldedRowIds.size).toBe(0);
    expect(working?.phase).toBe("working");
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

  it("folds the work a message cut across at once, leaving what still runs", () => {
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
    expect(cut.foldsWhenDone).toBe(false);
    expect(isTurnFolded(cut, 0)).toBe(true);
    expect(
      cut.rows
        .filter((row) => cut.foldedRowIds.has(row.id))
        .map((row) => row.kind === "activity" && row.title),
    ).toEqual(["Finished"]);
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

describe("the slot", () => {
  const cardKinds = (turn: Turn | undefined) =>
    turn
      ? cardsOf(turn).map(
          (card) => `${card.kind} x${card.steps.length.toString()}`,
        )
      : [];

  it("gives a burst of one kind one card, and calls that show nothing change nothing", () => {
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
        "files x3",
        "web x2",
        "page x1",
      ]
    `);
    expect(turn && slotOf(turn)?.kind).toBe("page");
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
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [said(id, "Done.")]),
        wake,
        message("assistant", (id) => [said(id, "Done.")]),
      ],
      { isRunning: false },
    );
    expect(turn?.rows.filter((row) => row.kind === "text")).toHaveLength(2);
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
      "a sign-in nothing has settled",
      "connect_app",
      { apps: ["notion"] },
      { state: "asked" },
      "output-available",
    ],
  ] as const)(
    "keeps %s out of the fold",
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
      const ask = turn?.rows.find((row) => row.kind === "ask");
      expect(ask && turn?.foldedRowIds.has(ask.id)).toBe(false);
      expect(turn?.foldedRowIds.size).toBe(1);
    },
  );

  it("folds a sign-in an app event has settled", () => {
    const [turn] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          call(id, "connect_app", { apps: ["notion"] }, { state: "asked" }),
        ]),
        message("user", (id) => [
          {
            data: { app: "notion", kind: "connected" },
            metadata: meta(id),
            type: "data-appEvent",
          } as unknown as SessionMessagePart.Type,
        ]),
        message("assistant", (id) => [said(id, "Connected.")]),
      ],
      { isRunning: false },
    );
    const ask = turn?.rows.find((row) => row.kind === "ask");
    expect(ask && turn?.foldedRowIds.has(ask.id)).toBe(true);
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
    expect(turn && slotOf(turn)).toBeUndefined();
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
    expect(turn && slotOf(turn)).toBeUndefined();
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

  it("says when the work has moved past the card", () => {
    const [behind] = turnsOf(
      [
        typed("Do the thing"),
        message("assistant", (id) => [
          call(id, "write_file", {
            activity: "Writing",
            content: "a",
            filePath: "/a.md",
          }),
          call(
            id,
            "bash",
            { activity: "Checking", command: "sleep 5" },
            undefined,
            "input-available",
          ),
        ]),
      ],
      { isRunning: true },
    );
    const card = behind && slotOf(behind);
    expect(card && behind && isSlotBehind(card, behind)).toBe(true);
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
    const card = turn && slotOf(turn);
    expect(card?.kind).toBe("files");
    expect(card?.changedFiles).toEqual(["/work/report.csv"]);
    const row = turn?.rows[0];
    expect(row?.kind === "activity" && row.counts).toEqual([
      { count: 9, label: "rows added" },
    ]);
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
