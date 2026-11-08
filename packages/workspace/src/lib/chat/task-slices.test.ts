import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { taskSlices } from "./task-slices";

const sessionId = StoreId.newSessionId();
const at = (minute: number) => new Date(Date.UTC(2026, 10, 8, 9, minute));

function meta(messageId: StoreId.Message, minute: number) {
  return {
    createdAt: at(minute),
    id: StoreId.newPartId(),
    messageId,
    sessionId,
  };
}

/** What the chat wrote into the task: its assignment, or a later `task send`. */
function fromChat(
  kind: "assignment" | "message",
  text: string,
  minute: number,
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: { createdAt: at(minute), sessionId },
    parts: [
      SessionMessagePart.coerce({
        data: { kind, text },
        metadata: meta(id, minute),
        type: "data-fromChat",
      }),
    ],
    role: "user",
  };
}

/** One step of the task's: a call that ran from `minute` to `until`, then any words. */
function step(
  minute: number,
  until: number,
  {
    activity,
    failed,
    said,
    summary,
    summaryAt = until,
  }: {
    activity: string;
    /** It ended on a model error. */
    failed?: true;
    said?: string;
    summary?: string;
    /** When the separate call after the turn wrote the summary. */
    summaryAt?: number;
  },
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: {
      createdAt: at(minute),
      ...(failed && {
        error: { kind: "disk-full" as const, message: "No space left" },
      }),
      finishReason: said === undefined ? "tool-calls" : "stop",
      finishedAt: at(until),
      modelId: "mock-model",
      providerId: "mock-provider",
      sessionId,
    },
    parts: [
      SessionMessagePart.coerce({
        input: { activity, command: "ls", explanation: activity },
        metadata: {
          ...meta(id, minute),
          endedAt: at(until),
          startedAt: at(minute),
        },
        output: { exitCode: 0, stdout: "" },
        state: "output-available",
        toolCallId: StoreId.ToolCallSchema.parse(`call-${id}`),
        type: "tool-bash",
      }),
      ...(said === undefined
        ? []
        : [
            SessionMessagePart.coerce({
              metadata: meta(id, until),
              text: said,
              type: "text",
            }),
          ]),
      ...(summary === undefined
        ? []
        : [
            SessionMessagePart.coerce({
              data: { words: summary },
              metadata: meta(id, summaryAt),
              type: "data-workSummary",
            }),
          ]),
    ],
    role: "assistant",
  };
}

const firstRun = [
  fromChat("assignment", "Compare the three pricing pages.", 0),
  step(0, 2, { activity: "Reading pricing pages" }),
  step(2, 3, {
    activity: "Noting every tier",
    said: "Our Team plan is 18% under Zendesk.",
    summary: "Noted every tier on three pricing pages",
  }),
];

const shape = (slices: ReturnType<typeof taskSlices>) =>
  slices.map((slice) => ({
    from: slice.from,
    line: slice.line,
    span: `${slice.startedAt.toISOString().slice(11, 16)}-${slice.endedAt.toISOString().slice(11, 16)}`,
  }));

describe("taskSlices", () => {
  it("leaves the first run's slice as it was after a send to the finished task", () => {
    const before = taskSlices(firstRun);
    const sent = fromChat("message", "Check last year's prices too.", 40);
    const after = taskSlices([
      ...firstRun,
      sent,
      step(40, 41, { activity: "Reading 2025 plans" }),
    ]);
    expect(after[0]).toStrictEqual(before[0]);
    expect(shape(after)).toStrictEqual([
      {
        from: firstRun[0]?.id,
        line: "Noted every tier on three pricing pages",
        span: "09:00-09:03",
      },
      { from: sent.id, line: "Reading 2025 plans", span: "09:40-09:41" },
    ]);
  });

  it("reads a sent slice's span and line from its own records alone", () => {
    const sent = fromChat("message", "Check last year's prices too.", 40);
    const slices = taskSlices([
      ...firstRun,
      sent,
      step(40, 41, { activity: "Reading 2025 plans" }),
      step(41, 42, {
        activity: "Comparing the years",
        said: "Zendesk and Freshdesk both raised their mid tiers.",
      }),
    ]);
    expect(shape(slices).at(-1)).toStrictEqual({
      from: sent.id,
      line: "Zendesk and Freshdesk both raised their mid tiers.",
      span: "09:40-09:42",
    });
  });

  it("closes a busy run's slice at the message sent into it", () => {
    const sent = fromChat("message", "Include Freshdesk's add-ons.", 1);
    const slices = taskSlices([
      fromChat("assignment", "Compare the three pricing pages.", 0),
      step(0, 1, { activity: "Noted Zendesk and Intercom tiers" }),
      sent,
      step(1, 2, { activity: "Reading add-ons on freshdesk.com" }),
    ]);
    expect(shape(slices)).toStrictEqual([
      {
        from: slices[0]?.from,
        line: "Noted Zendesk and Intercom tiers",
        span: "09:00-09:01",
      },
      {
        from: sent.id,
        line: "Reading add-ons on freshdesk.com",
        span: "09:01-09:02",
      },
    ]);
  });

  it("starts a sent slice at the delivered message, not at the step before", () => {
    const sent = fromChat("message", "Check last year's prices too.", 40);
    const slices = taskSlices([...firstRun, sent]);
    expect(slices.at(-1)).toStrictEqual({
      endedAt: at(40),
      from: sent.id,
      startedAt: at(40),
    });
  });

  it("leaves what a step in flight wrote after the send to the next slice", () => {
    const sent = fromChat("message", "Include Freshdesk's add-ons.", 2);
    const slices = taskSlices([
      fromChat("assignment", "Compare the three pricing pages.", 0),
      // Its call ran on to 09:05 and its words came then, after the send.
      step(0, 5, {
        activity: "Reading pricing pages",
        said: "Read all three.",
      }),
      sent,
      step(5, 6, { activity: "Reading add-ons on freshdesk.com" }),
    ]);
    expect(shape(slices)[0]).toStrictEqual({
      from: slices[0]?.from,
      line: "Reading pricing pages",
      span: "09:00-09:02",
    });
  });

  it("keeps a work summary written after the work out of its span, and out of an earlier slice once a send came first", () => {
    const late = [
      fromChat("assignment", "Compare the three pricing pages.", 0),
      step(0, 3, {
        activity: "Noting every tier",
        said: "Our Team plan is 18% under Zendesk.",
        summary: "Noted every tier on three pricing pages",
        summaryAt: 5,
      }),
    ];
    expect(shape(taskSlices(late))).toStrictEqual([
      {
        from: late[0]?.id,
        line: "Noted every tier on three pricing pages",
        span: "09:00-09:03",
      },
    ]);
    const sent = fromChat("message", "Check last year's prices too.", 4);
    expect(shape(taskSlices([...late, sent]))[0]).toStrictEqual({
      from: late[0]?.id,
      line: "Our Team plan is 18% under Zendesk.",
      span: "09:00-09:03",
    });
  });

  it("keeps a failed run failed after the chat sends it on", () => {
    const slices = taskSlices([
      fromChat("assignment", "Compare the three pricing pages.", 0),
      step(0, 1, { activity: "Reading pricing pages", failed: true }),
      fromChat("message", "Try again.", 5),
      step(5, 6, { activity: "Reading pricing pages" }),
    ]);
    expect(slices.map(({ failed, line }) => ({ failed, line })))
      .toMatchInlineSnapshot(`
        [
          {
            "failed": true,
            "line": "Disk is full",
          },
          {
            "failed": undefined,
            "line": "Reading pricing pages",
          },
        ]
      `);
  });
});
