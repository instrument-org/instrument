import { describe, expect, it } from "vitest";

import { UNTITLED_CHAT_TITLE } from "../../constants";
import { logFileName, settingsFileName } from "./file-names";
import { foldChat } from "./fold";
import { type LogRecord, type SettingRecord, recordLine } from "./record";
import { sessionOf } from "./session-of";
import {
  assistantMessage,
  at,
  DEVICE_A,
  header,
  messageId,
  messageRecord,
  sessionId,
  userMessage,
} from "./test-records";

/** A mark as a test writes it, before the marks file gives it its place. */
type Mark<R = SettingRecord> = R extends unknown
  ? Omit<R, "device" | "seq" | "t">
  : never;

const chatSession = sessionId(1);
const taskSession = sessionId(2);

function folded(
  records: LogRecord[],
  marks: Mark[] = [],
  session = chatSession,
) {
  const files = [
    {
      bytes: Buffer.from(records.map(recordLine).join("")),
      name: logFileName(session, DEVICE_A),
    },
    {
      bytes: Buffer.from(
        marks
          .map((mark, seq) =>
            recordLine({ ...mark, device: DEVICE_A, seq, t: "set" }),
          )
          .join(""),
      ),
      name: settingsFileName(DEVICE_A),
    },
  ];
  const found = foldChat(files).sessions.find(({ id }) => id === session);
  if (!found) {
    throw new Error("The session did not fold");
  }
  return found;
}

describe("sessionOf", () => {
  it("dates each of the person's marks from when it was made", () => {
    const session = folded(
      [
        header(0, { device: DEVICE_A, id: chatSession }),
        messageRecord(1, userMessage(chatSession, messageId(1), at(1))),
      ],
      [
        { at: at(2), field: "archived", session: chatSession, value: true },
        { at: at(3), field: "starred", session: chatSession, value: true },
        {
          at: at(4),
          field: "unread",
          session: chatSession,
          value: "marked",
        },
        {
          at: at(5),
          field: "title",
          session: chatSession,
          value: { auto: false, text: "Quarterly numbers" },
        },
        {
          at: at(6),
          field: "topic",
          session: chatSession,
          value: "top_1",
        },
      ],
    );

    expect(sessionOf(session)).toEqual({
      archivedAt: at(2),
      createdAt: at(0),
      id: chatSession,
      starredAt: at(3),
      title: "Quarterly numbers",
      titleSettledAt: at(5),
      topic: "top_1",
      unreadAt: at(4),
      unreadByUser: true,
      updatedAt: at(1),
    });
  });

  it("leaves out marks taken off, and names an untitled chat the way a new one is", () => {
    const session = folded(
      [header(0, { device: DEVICE_A, id: chatSession })],
      [
        { at: at(1), field: "archived", session: chatSession, value: true },
        { at: at(2), field: "archived", session: chatSession, value: false },
        { at: at(3), field: "starred", session: chatSession, value: false },
        {
          at: at(4),
          field: "unread",
          session: chatSession,
          value: "new",
        },
        { at: at(5), field: "unread", session: chatSession, value: null },
        {
          at: at(6),
          field: "title",
          session: chatSession,
          value: { auto: true, text: "Untitled chat 2" },
        },
      ],
    );

    expect(sessionOf(session)).toEqual({
      createdAt: at(0),
      id: chatSession,
      title: "Untitled chat 2",
      titleByApp: true,
      updatedAt: at(0),
    });
    expect(
      sessionOf(folded([header(0, { device: DEVICE_A, id: chatSession })]))
        .title,
    ).toBe(UNTITLED_CHAT_TITLE);
  });

  it("reads a chat started as its opening words as untitled until a setting names it", () => {
    const opened = [
      header(0, {
        device: DEVICE_A,
        id: chatSession,
        startedAs: "Find a quiet dishwasher",
      }),
    ];

    expect(sessionOf(folded(opened)).title).toBe(UNTITLED_CHAT_TITLE);
    expect(
      sessionOf(
        folded(opened, [
          {
            at: at(1),
            field: "title",
            session: chatSession,
            value: { auto: true, text: "Quiet dishwasher picks" },
          },
        ]),
      ).title,
    ).toBe("Quiet dishwasher picks");
  });

  it.each([
    {
      case: "the app's name",
      expected: true,
      lines: [{ auto: true, text: "Sailing card for dad" }],
    },
    {
      case: "the app's name once it settled it",
      expected: true,
      lines: [
        { auto: true, text: "Sailing card for dad" },
        { auto: false, text: "Sailing card for dad" },
      ],
    },
    {
      case: "the person's rename of an unsettled title",
      expected: false,
      lines: [
        { auto: true, text: "Sailing card for dad" },
        { auto: false, text: "Dad's card" },
      ],
    },
    {
      case: "the person's rename of a settled title",
      expected: false,
      lines: [
        { auto: true, text: "Sailing card for dad" },
        { auto: false, text: "Sailing card for dad" },
        { auto: false, text: "Dad's card" },
      ],
    },
    {
      case: "the person's name with nothing from the app",
      expected: false,
      lines: [{ auto: false, text: "Dad's card" }],
    },
  ])("says whether the title is the app's: $case", ({ expected, lines }) => {
    const session = folded(
      [header(0, { device: DEVICE_A, id: chatSession })],
      lines.map((value, index) => ({
        at: at(index + 1),
        field: "title",
        session: chatSession,
        value,
      })),
    );

    expect(sessionOf(session).titleByApp === true).toBe(expected);
  });

  it("reads a task's fork, rollover and stop, which holds until a turn starts after it", () => {
    const task = [
      header(0, {
        device: DEVICE_A,
        forkedAt: messageId(1),
        handle: "t1",
        id: taskSession,
        parent: chatSession,
        startedAs: "Look into it",
      }),
      messageRecord(1, userMessage(taskSession, messageId(2), at(1))),
      messageRecord(2, assistantMessage(taskSession, messageId(3), at(2))),
      {
        t: "rollover",
        seq: 3,
        at: at(3),
        after: messageId(3),
        usableTokens: 1000,
      },
      { t: "stop", seq: 4, at: at(4), by: "agent" },
    ] satisfies LogRecord[];

    expect(sessionOf(folded(task, [], taskSession))).toEqual({
      createdAt: at(0),
      forkedAtMessageId: messageId(1),
      handle: "t1",
      id: taskSession,
      parentId: chatSession,
      rolledOverAfterMessageId: messageId(3),
      rolledOverUnderUsableTokens: 1000,
      stoppedBy: "agent",
      title: "Look into it",
      updatedAt: at(4),
    });

    const resumed = sessionOf(
      folded(
        [
          ...task,
          messageRecord(5, userMessage(taskSession, messageId(4), at(5))),
        ],
        [],
        taskSession,
      ),
    );
    expect(resumed).not.toHaveProperty("stoppedBy");
    expect(resumed.updatedAt).toEqual(at(5));
  });
});
