import { describe, expect, it } from "vitest";

import { FILE_START, readLog, readMarks } from "./read-records";
import { type LogRecord, type MarkRecord, recordLine } from "./record";
import {
  at,
  DEVICE_A,
  header,
  messageId,
  messageRecord,
  sessionId,
  userMessage,
} from "./test-records";

const session = sessionId(1);

function message(seq: number): LogRecord {
  return messageRecord(seq, userMessage(session, messageId(seq), at(seq)));
}

function bytes(...lines: string[]): Uint8Array {
  return Buffer.from(lines.join(""));
}

const HEADER = recordLine(header(0, { device: DEVICE_A, id: session }));

describe("readLog", () => {
  it("takes whole lines and leaves a torn last line for the next read", () => {
    const second = recordLine(message(2));
    const file = bytes(HEADER, recordLine(message(1)), second.slice(0, 30));

    const first = readOrThrow(file);
    expect(first).toMatchObject({
      cursor: { lastSeq: 1, offset: file.length - 30 },
      skipped: 0,
    });

    const grown = bytes(HEADER, recordLine(message(1)), second);
    expect(
      readOrThrow(grown.subarray(first.cursor.offset), first.cursor),
    ).toMatchObject({
      cursor: { lastSeq: 2, offset: grown.length },
      records: [{ offset: first.cursor.offset, record: message(2) }],
      skipped: 0,
    });
  });

  it("counts and skips a torn line that got its newline", () => {
    const torn = recordLine(message(2)).slice(0, 25);
    const read = readLog(
      bytes(
        HEADER,
        recordLine(message(1)),
        `${torn}\n`,
        recordLine(message(3)),
      ),
    );

    expect(read).toMatchObject({ kind: "read", skipped: 1 });
    expect(seqs(read)).toEqual([0, 1, 3]);
  });

  it.each([
    ["a line that is not JSON", "not json\n"],
    ["a line that is not a record", '{"t":"later","seq":9}\n'],
    ["a repeated seq", recordLine(message(1))],
    ["an older seq", recordLine(message(0))],
    [
      "a second header",
      recordLine(header(5, { device: DEVICE_A, id: session })),
    ],
    ["a mark", recordLine(mark(5))],
    ["a blank line", "\n"],
  ])("counts and skips %s", (_name, line) => {
    const read = readLog(
      bytes(HEADER, recordLine(message(1)), line, recordLine(message(6))),
    );

    expect(read).toMatchObject({ kind: "read", skipped: 1 });
    expect(seqs(read)).toEqual([0, 1, 6]);
  });

  it("counts and skips a line that is not UTF-8", () => {
    const file = Buffer.concat([
      bytes(HEADER),
      Buffer.from([0xff, 0xfe, 0x0a]),
      bytes(recordLine(message(1))),
    ]);

    expect(readLog(file)).toMatchObject({ kind: "read", skipped: 1 });
  });

  it.each([
    ["a message", bytes(recordLine(message(0)), HEADER)],
    ["a line that is not JSON", bytes("{oops\n", HEADER)],
    ["a blank line", bytes("\n", HEADER)],
  ])("refuses a file that starts with %s", (_name, file) => {
    expect(readLog(file)).toEqual({
      kind: "refused",
      reason: "no-session-header",
    });
  });

  it.each([
    ["an empty file", bytes()],
    ["a header still arriving", bytes(HEADER.slice(0, 20))],
  ])("reads nothing yet from %s", (_name, file) => {
    expect(readLog(file)).toEqual({
      cursor: FILE_START,
      kind: "read",
      records: [],
      skipped: 0,
    });
  });

  it("reads on from a cursor without asking for the header again", () => {
    const head = bytes(HEADER, recordLine(message(1)));
    const rest = bytes(recordLine(message(1)), recordLine(message(2)));

    const read = readLog(rest, { lastSeq: 1, offset: head.length });

    expect(read).toMatchObject({
      cursor: { lastSeq: 2, offset: head.length + rest.length },
      kind: "read",
      skipped: 1,
    });
    expect(seqs(read)).toEqual([2]);
  });
});

describe("readMarks", () => {
  it("takes marks and skips anything else", () => {
    const read = readMarks(
      bytes(recordLine(mark(0)), HEADER, recordLine(mark(1)), "{"),
    );

    expect(read).toMatchObject({ skipped: 1 });
    expect(read.records.map(({ record }) => record.seq)).toEqual([0, 1]);
  });
});

function readOrThrow(...args: Parameters<typeof readLog>) {
  const read = readLog(...args);
  if (read.kind !== "read") {
    throw new Error("The log was refused");
  }
  return read;
}

function seqs(read: ReturnType<typeof readLog>): number[] {
  return read.kind === "read"
    ? read.records.map(({ record }) => record.seq)
    : [];
}

function mark(seq: number): MarkRecord {
  return {
    t: "mark",
    seq,
    at: at(seq),
    session,
    field: "starred",
    value: true,
    device: DEVICE_A,
  };
}
