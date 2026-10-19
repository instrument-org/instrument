import { describe, expect, it } from "vitest";

import {
  type LogRecord,
  type SettingRecord,
  parseLogLine,
  parseSettingLine,
  recordLine,
} from "./record";
import {
  assistantMessage,
  at,
  DEVICE_A,
  DEVICE_B,
  header,
  messageId,
  messageRecord,
  partId,
  partRecord,
  sessionId,
  textPart,
  toolPart,
  userMessage,
} from "./test-records";

const session = sessionId(1);

describe("recordLine", () => {
  it("writes t, seq and at first, dates as ISO strings and a newline last", () => {
    const message = userMessage(session, messageId(1), at(5));
    expect(recordLine(messageRecord(1, message))).toMatchInlineSnapshot(`
      "{"t":"message","seq":1,"at":"2026-10-14T12:00:05.000Z","message":{"id":"msg_01K7A000000000000000000001","metadata":{"createdAt":"2026-10-14T12:00:05.000Z","sessionId":"ses_01K7A000000000000000000001"},"role":"user"}}
      "
    `);
  });

  it("leaves out undefined fields and usage reported as NaN", () => {
    const message = assistantMessage(session, messageId(2), at(6), {
      endedAt: undefined,
      usage: {
        inputTokenDetails: {
          cacheReadTokens: Number.NaN,
          cacheWriteTokens: undefined,
          noCacheTokens: 10,
        },
        inputTokens: 10,
        outputTokenDetails: {},
        outputTokens: Number.NaN,
        totalTokens: 10,
      },
    });
    const line = recordLine(messageRecord(2, message));
    expect(line).not.toContain("endedAt");
    expect(line).not.toContain("NaN");
    expect(line).not.toContain("null");
    expect(parseLogLine(line)).toMatchObject({
      message: {
        metadata: {
          usage: {
            inputTokenDetails: { noCacheTokens: 10 },
            inputTokens: 10,
            totalTokens: 10,
          },
        },
      },
    });
  });
});

describe("parseLogLine", () => {
  it.each<[string, LogRecord]>([
    ["a header", header(0, { device: DEVICE_A, id: session })],
    [
      "a continuation header",
      header(0, {
        continues: { [DEVICE_A]: 41, [`${DEVICE_B}.2`]: 3 },
        device: DEVICE_B,
        forkedAt: messageId(1),
        handle: "t1",
        id: sessionId(2),
        parent: session,
        title: "Look into it",
      }),
    ],
    [
      "an assistant message",
      messageRecord(
        1,
        assistantMessage(session, messageId(2), at(6), {
          finishedAt: at(9),
        }),
      ),
    ],
    [
      "a text part",
      partRecord(2, textPart(session, messageId(2), partId(1), "Hello", at(7))),
    ],
    [
      "a tool part with its start and end",
      partRecord(
        3,
        toolPart({
          createdAt: at(7),
          id: partId(2),
          message: messageId(2),
          more: { endedAt: at(9), output: { stdout: "a\n" }, startedAt: at(8) },
          session,
          state: "output-available",
        }),
      ),
    ],
    [
      "a retract",
      { at: at(1), messages: [messageId(1)], seq: 4, t: "retract", why: "x" },
    ],
    [
      "a rollover",
      {
        after: messageId(1),
        at: at(1),
        seq: 5,
        t: "rollover",
        usableTokens: 1000,
      },
    ],
    ["a stop", { at: at(1), by: "chat", seq: 6, t: "stopped" }],
    [
      "something told",
      {
        at: at(1),
        seq: 7,
        t: "state",
        value: [{ path: "/a" }],
        what: "folders",
      },
    ],
    [
      "something cleared",
      { at: at(1), seq: 8, t: "state", value: null, what: "browser" },
    ],
  ])("reads back %s as written", (_name, record) => {
    expect(parseLogLine(recordLine(record))).toEqual(record);
  });

  it.each([
    ["a torn line", '{"t":"message","seq":1,"at":"2026-10-14T12:'],
    ["a JSON value that is not an object", "[1,2,3]"],
    [
      "an unknown record type",
      '{"t":"later","seq":1,"at":"2026-10-14T12:00:00.000Z"}',
    ],
    [
      "a date that is not ISO",
      '{"t":"stopped","seq":1,"at":"yesterday","by":"user"}',
    ],
    [
      "a negative seq",
      '{"t":"stopped","seq":-1,"at":"2026-10-14T12:00:00.000Z","by":"user"}',
    ],
    [
      "a setting, which only a settings file holds",
      recordLine(titleMark(1, "Hi", true)),
    ],
    [
      "a message whose date is not ISO",
      recordLine(
        messageRecord(1, userMessage(session, messageId(1), at(1))),
      ).replace('"createdAt":"2026-10-14T12:00:01.000Z"', '"createdAt":"soon"'),
    ],
    [
      "a part that names no message",
      recordLine(
        partRecord(1, textPart(session, messageId(1), partId(1), "x", at(1))),
      ).replace(/"messageId":"[^"]+",/, ""),
    ],
    [
      "a header continuing a log that is not a device's",
      recordLine(
        header(0, { continues: { "../x": 1 }, device: DEVICE_A, id: session }),
      ),
    ],
  ])("refuses %s", (_name, line) => {
    expect(parseLogLine(line)).toBeUndefined();
  });
});

describe("parseSettingLine", () => {
  it.each<[string, SettingRecord]>([
    ["a title", titleMark(0, "Plans", false)],
    ["a star", mark(1, { field: "starred", value: true })],
    ["an archive", mark(2, { field: "archived", value: false })],
    ["unread", mark(3, { field: "unread", value: "marked" })],
    ["a model", mark(7, { field: "model", value: "openai/gpt-6.1-sol" })],
    ["read", mark(4, { field: "unread", value: null })],
    ["a topic", mark(5, { field: "topic", value: "work" })],
    ["no topic", mark(5, { field: "topic", value: null })],
    ["a stop", mark(6, { field: "stoppedAt", value: at(3) })],
  ])("reads back %s as written", (_name, record) => {
    expect(parseSettingLine(recordLine(record))).toEqual(record);
  });

  it.each<[string, string, SettingRecord]>([
    [
      "a settled title",
      '"field":"title","value":{"text":"Plans","settled":true}',
      titleMark(0, "Plans", true),
    ],
    [
      "a title the app may change",
      '"field":"title","value":{"text":"Plans","settled":false}',
      titleMark(0, "Plans", false),
    ],
    [
      "unread by the person",
      '"field":"unread","value":{"byUser":true}',
      mark(0, { field: "unread", value: "marked" }),
    ],
    [
      "unread by the app",
      '"field":"unread","value":{"byUser":false}',
      mark(0, { field: "unread", value: "new" }),
    ],
    [
      "read",
      '"field":"unread","value":null',
      mark(0, { field: "unread", value: null }),
    ],
    [
      "a list of topics",
      '"field":"topics","value":["work","home"]',
      mark(0, { field: "topic", value: "work" }),
    ],
    [
      "an empty list of topics",
      '"field":"topics","value":[]',
      mark(0, { field: "topic", value: null }),
    ],
  ])("reads an older mark line of %s as its setting", (_name, body, record) => {
    const line = `{"t":"mark","seq":0,"at":"${at(0).toISOString()}","session":"${session}",${body},"device":"${DEVICE_A}"}`;
    expect(parseSettingLine(line)).toEqual(record);
  });

  it("refuses a value of another field's kind", () => {
    const line = recordLine(mark(1, { field: "starred", value: true }));
    expect(
      parseSettingLine(line.replace('"value":true', '"value":"yes"')),
    ).toBeUndefined();
  });
});

/** A setting's field and value, still paired. */
type MarkBody<M = SettingRecord> = M extends SettingRecord
  ? Pick<M, "field" | "value">
  : never;

function mark(seq: number, body: MarkBody): SettingRecord {
  return { t: "set", seq, at: at(seq), session, device: DEVICE_A, ...body };
}

function titleMark(seq: number, text: string, settled: boolean): SettingRecord {
  return mark(seq, { field: "title", value: { auto: !settled, text } });
}
