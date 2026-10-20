import { describe, expect, it } from "vitest";

import { type DeviceId } from "./device-id";
import { logFileName, settingsFileName } from "./file-names";
import { ChatFold, type FoldedChat, foldChat, historyOf } from "./fold";
import { type LogRecord, type SettingRecord, recordLine } from "./record";
import { createRandom } from "./seeded-random";
import {
  assistantMessage,
  at,
  DEVICE_A,
  DEVICE_B,
  DEVICE_C,
  header,
  messageId,
  messageRecord,
  partId,
  partRecord,
  sessionId,
  textPart,
  userMessage,
} from "./test-records";

const chatSession = sessionId(1);
const taskSession = sessionId(2);

function file(name: string, records: (LogRecord | SettingRecord)[]) {
  return { bytes: Buffer.from(records.map(recordLine).join("")), name };
}

function log(
  device: DeviceId,
  records: LogRecord[],
  { generation = 1, session = chatSession } = {},
) {
  return file(logFileName(session, device, generation), records);
}

function user(n: number, seconds = n, session = chatSession) {
  return userMessage(session, messageId(n), at(seconds));
}

function text(message: number, n: number, words: string, seconds = n) {
  return textPart(
    chatSession,
    messageId(message),
    partId(n),
    words,
    at(seconds),
  );
}

function messageIds(chat: FoldedChat, session = chatSession) {
  return chat.sessions
    .find(({ id }) => id === session)
    ?.messages.map(({ id, parts }) => [
      id,
      parts.map((part) => (part.type === "text" ? part.text : part.type)),
    ]);
}

const HEADER_A = header(0, { device: DEVICE_A, id: chatSession });

describe("foldChat", () => {
  it("keeps the newest snapshot of each message and part, ordered by id", () => {
    const chat = foldChat([
      log(DEVICE_A, [
        HEADER_A,
        messageRecord(1, user(2)),
        partRecord(2, text(2, 3, "second")),
        messageRecord(3, user(1)),
        partRecord(4, text(1, 2, "draft")),
        partRecord(5, text(1, 1, "first")),
        partRecord(6, text(1, 2, "done")),
        messageRecord(
          7,
          assistantMessage(chatSession, messageId(2), at(2), {
            finishReason: "length",
          }),
        ),
      ]),
    ]);

    expect(messageIds(chat)).toEqual([
      [messageId(1), ["first", "done"]],
      [messageId(2), ["second"]],
    ]);
    expect(chat.sessions[0]?.messages[1]?.role).toBe("assistant");
  });

  it("drops what a retract names and its parts, wherever the retract is read", () => {
    const records = [
      messageRecord(1, user(1)),
      partRecord(2, text(1, 1, "kept")),
      messageRecord(3, user(2)),
      partRecord(4, text(2, 2, "gone")),
    ];
    const retract: LogRecord = {
      t: "retract",
      seq: 5,
      at: at(3),
      messages: [messageId(2)],
      why: "edited",
    };

    for (const order of [
      [HEADER_A, ...records, retract],
      [
        HEADER_A,
        retract,
        ...records.map((record) => ({ ...record, seq: record.seq + 5 })),
      ],
    ]) {
      expect(messageIds(foldChat([log(DEVICE_A, order)]))).toEqual([
        [messageId(1), ["kept"]],
      ]);
    }
  });

  it("keeps the newest rollover, stop and each thing state, and drops what was cleared", () => {
    const [session] = foldChat([
      log(DEVICE_A, [
        HEADER_A,
        { t: "rollover", seq: 1, at: at(1), after: messageId(1) },
        {
          t: "rollover",
          seq: 2,
          at: at(2),
          after: messageId(2),
          usableTokens: 9,
        },
        { t: "stopped", seq: 3, at: at(3), by: "app" },
        { t: "stopped", seq: 4, at: at(4), by: "user" },
        { t: "state", seq: 5, at: at(5), what: "folders", value: ["/a"] },
        {
          t: "state",
          seq: 6,
          at: at(6),
          what: "browser",
          value: { host: "x" },
        },
        { t: "state", seq: 7, at: at(7), what: "folders", value: ["/a", "/b"] },
        { t: "state", seq: 8, at: at(8), what: "browser", value: null },
      ]),
    ]).sessions;

    expect(session).toMatchObject({
      rollover: { after: messageId(2), usableTokens: 9 },
      stopped: { at: at(4), by: "user" },
      state: { folders: ["/a", "/b"] },
      updatedAt: at(8),
    });
    expect(session?.state).not.toHaveProperty("browser");
  });

  it("merges marks across devices by newest, ties to the larger device id", () => {
    const star = (
      device: DeviceId,
      seq: number,
      seconds: number,
      value: boolean,
    ): SettingRecord => ({
      t: "set",
      seq,
      at: at(seconds),
      session: chatSession,
      field: "starred",
      value,
      device,
    });
    const chat = foldChat([
      log(DEVICE_A, [HEADER_A]),
      file(settingsFileName(DEVICE_A), [
        star(DEVICE_A, 0, 1, true),
        star(DEVICE_A, 1, 5, false),
      ]),
      file(settingsFileName(DEVICE_B), [star(DEVICE_B, 0, 5, true)]),
    ]);

    expect(chat.sessions[0]?.settings.starred).toMatchObject({
      device: DEVICE_B,
      value: true,
    });
  });

  it("never lets a title the app may change win over one that settled", () => {
    const title = (
      device: DeviceId,
      seconds: number,
      words: string,
      settled: boolean,
    ): SettingRecord => ({
      t: "set",
      seq: 0,
      at: at(seconds),
      session: chatSession,
      field: "title",
      value: { auto: !settled, text: words },
      device,
    });
    const chat = foldChat([
      log(DEVICE_A, [HEADER_A]),
      file(settingsFileName(DEVICE_A), [title(DEVICE_A, 1, "Named", true)]),
      file(settingsFileName(DEVICE_B), [title(DEVICE_B, 9, "New chat", false)]),
    ]);

    expect(chat.sessions[0]?.settings.title?.value).toEqual({
      auto: false,
      text: "Named",
    });
  });

  it("reads a task's history as its parent's up to where it forked, then its own", () => {
    const chat = foldChat([
      log(DEVICE_A, [
        HEADER_A,
        messageRecord(1, user(1)),
        messageRecord(2, user(2)),
        messageRecord(3, user(5)),
      ]),
      log(
        DEVICE_A,
        [
          header(0, {
            device: DEVICE_A,
            forkedAt: messageId(2),
            handle: "t1",
            id: taskSession,
            parent: chatSession,
            title: "Look into it",
          }),
          messageRecord(1, user(3, 3, taskSession)),
        ],
        { session: taskSession },
      ),
    ]);

    expect(historyOf(chat, taskSession).map(({ id }) => id)).toEqual([
      messageId(1),
      messageId(2),
      messageId(3),
    ]);
    expect(chat.sessions[1]).toMatchObject({
      forked: false,
      forkedAt: messageId(2),
      handle: "t1",
      parent: chatSession,
      title: "Look into it",
    });
  });

  it("reads a session another device carried on after what that device read, whatever the clocks say", () => {
    const chat = foldChat([
      log(DEVICE_A, [
        HEADER_A,
        messageRecord(1, user(1)),
        partRecord(2, text(1, 1, "a's")),
      ]),
      log(DEVICE_B, [
        header(0, {
          continues: { [DEVICE_A]: 2 },
          device: DEVICE_B,
          id: chatSession,
        }),
        // Device B's clock is behind, and its snapshot still comes after A's.
        partRecord(1, text(1, 1, "b's"), at(-60)),
      ]),
    ]);

    expect(messageIds(chat)).toEqual([[messageId(1), ["b's"]]]);
    expect(chat.sessions[0]?.forked).toBe(false);
  });

  it("flags a session two devices carried on past what the other had read, and keeps both", () => {
    const fromA = log(DEVICE_A, [
      HEADER_A,
      messageRecord(1, user(1)),
      messageRecord(2, user(2)),
    ]);
    const fromB = log(DEVICE_B, [
      header(0, {
        continues: { [DEVICE_A]: 1 },
        device: DEVICE_B,
        id: chatSession,
      }),
      messageRecord(1, user(3)),
    ]);
    const handedBack = log(
      DEVICE_A,
      [
        header(0, {
          continues: { [DEVICE_A]: 1, [DEVICE_B]: 1 },
          device: DEVICE_A,
          id: chatSession,
        }),
        messageRecord(1, user(4)),
      ],
      { generation: 2 },
    );

    const forked = foldChat([fromA, fromB]);
    expect(forked.sessions[0]?.forked).toBe(true);
    expect(messageIds(forked)?.map(([id]) => id)).toEqual([
      messageId(1),
      messageId(2),
      messageId(3),
    ]);

    // A carried on from B in a new log, but its first log had already gone
    // past what B read: still a fork.
    expect(foldChat([fromA, fromB, handedBack]).sessions[0]?.forked).toBe(true);

    // A hand-off with nothing written side by side is not one.
    const handOff = log(DEVICE_A, [HEADER_A, messageRecord(1, user(1))]);
    expect(foldChat([handOff, fromB, handedBack]).sessions[0]?.forked).toBe(
      false,
    );
  });

  it("reads what a log's writer had read through the headers of the logs it read", () => {
    const fromA = log(DEVICE_A, [
      HEADER_A,
      messageRecord(1, user(1)),
      messageRecord(2, user(2)),
    ]);
    const fromB = log(DEVICE_B, [
      header(0, {
        continues: { [DEVICE_A]: 2 },
        device: DEVICE_B,
        id: chatSession,
      }),
      messageRecord(1, user(3)),
    ]);
    // A header that names only the log it read last, not what that log's
    // writer had read in turn.
    const fromC = log(DEVICE_C, [
      header(0, {
        continues: { [DEVICE_B]: 1 },
        device: DEVICE_C,
        id: chatSession,
      }),
      messageRecord(1, user(4)),
    ]);

    expect(foldChat([fromA, fromB, fromC]).sessions[0]?.forked).toBe(false);
  });

  it("says which device wrote the newest snapshot of each message and part", () => {
    const chat = foldChat([
      log(DEVICE_A, [
        HEADER_A,
        messageRecord(1, user(1)),
        partRecord(2, text(1, 1, "a's")),
        partRecord(3, text(1, 2, "a's only")),
        messageRecord(4, user(2)),
        partRecord(5, text(2, 3, "retracted")),
      ]),
      log(DEVICE_B, [
        header(0, {
          continues: { [DEVICE_A]: 5 },
          device: DEVICE_B,
          id: chatSession,
        }),
        partRecord(1, text(1, 1, "b's")),
        { t: "retract", seq: 2, at: at(9), messages: [messageId(2)], why: "x" },
      ]),
    ]);

    expect(Object.fromEntries(chat.sessions[0]?.writtenBy ?? [])).toEqual({
      [messageId(1)]: DEVICE_A,
      [partId(1)]: DEVICE_B,
      [partId(2)]: DEVICE_A,
    });
  });

  it("folds a conflict copy's records once", () => {
    const original = log(DEVICE_A, [
      HEADER_A,
      messageRecord(1, user(1)),
      partRecord(2, text(1, 1, "hi")),
    ]);
    const copy = {
      bytes: original.bytes.subarray(0, original.bytes.length - 10),
      name: original.name.replace(
        ".jsonl",
        " (Jeremy's conflicted copy 2026-10-14).jsonl",
      ),
    };

    expect(
      foldChat([
        original,
        copy,
        { ...original, name: original.name.replace(".jsonl", " 2.jsonl") },
      ]),
    ).toEqual(foldChat([original]));
  });

  it("refuses a log whose header names another session or device", () => {
    const fold = new ChatFold();
    fold.add(
      logFileName(chatSession, DEVICE_B),
      log(DEVICE_A, [HEADER_A, messageRecord(1, user(1))]).bytes,
    );
    fold.add("settings.json", Buffer.from("{}"));

    expect(fold.chat()).toEqual({ sessions: [] });
    expect(fold.problems()).toEqual([
      {
        name: logFileName(chatSession, DEVICE_B),
        refused: "header-names-another-log",
        skipped: 0,
      },
    ]);
  });

  it("says what a log it starts carries on from, through what others had read", () => {
    const fold = new ChatFold();
    for (const { bytes, name } of [
      log(DEVICE_B, [
        header(0, {
          continues: { [DEVICE_A]: 7 },
          device: DEVICE_B,
          id: chatSession,
        }),
        messageRecord(1, user(9)),
      ]),
      log(DEVICE_A, [HEADER_A, messageRecord(1, user(1))]),
    ]) {
      fold.add(name, bytes);
    }

    expect(fold.continuesFor(chatSession)).toEqual({
      [DEVICE_A]: 7,
      [DEVICE_B]: 1,
    });
    expect(fold.continuesFor(taskSession)).toEqual({});
  });
});

describe("ChatFold", () => {
  it("builds again only the sessions something new was folded for", () => {
    const fold = new ChatFold();
    for (const { bytes, name } of [
      log(DEVICE_A, [HEADER_A, messageRecord(1, user(1))]),
      log(
        DEVICE_A,
        [
          header(0, { device: DEVICE_A, id: taskSession }),
          messageRecord(1, user(2, 2, taskSession)),
        ],
        { session: taskSession },
      ),
    ]) {
      fold.add(name, bytes);
    }
    const first = fold.chat();
    expect(fold.chat()).toBe(first);

    const taskLog = logFileName(taskSession, DEVICE_A);
    fold.add(
      taskLog,
      Buffer.from(recordLine(messageRecord(2, user(3, 3, taskSession)))),
    );
    const second = fold.chat();
    expect(second.sessions[0]).toBe(first.sessions[0]);
    expect(second.sessions[1]).not.toBe(first.sessions[1]);
    expect(second.sessions[1]?.messages).toHaveLength(2);

    fold.add(
      settingsFileName(DEVICE_A),
      Buffer.from(
        recordLine({
          t: "set",
          seq: 0,
          at: at(4),
          session: chatSession,
          field: "starred",
          value: true,
          device: DEVICE_A,
        }),
      ),
    );
    const third = fold.chat();
    expect(third.sessions[0]).not.toBe(second.sessions[0]);
    expect(third.sessions[0]?.settings.starred?.value).toBe(true);
    expect(third.sessions[1]).toBe(second.sessions[1]);

    // A copy of a record already folded changes nothing.
    fold.add(
      `${taskLog.replace(".jsonl", " 2.jsonl")}`,
      log(
        DEVICE_A,
        [
          header(0, { device: DEVICE_A, id: taskSession }),
          messageRecord(1, user(2, 2, taskSession)),
        ],
        { session: taskSession },
      ).bytes,
    );
    expect(fold.chat()).toBe(third);
  });

  it("folds files fed a few bytes at a time to what it folds from scratch", () => {
    const files = [
      log(DEVICE_A, [
        HEADER_A,
        messageRecord(1, user(1)),
        partRecord(2, text(1, 1, "hello")),
        partRecord(3, text(1, 1, "hello again")),
        { t: "retract", seq: 4, at: at(4), messages: [messageId(9)], why: "x" },
        messageRecord(5, user(2)),
        { t: "state", seq: 6, at: at(6), what: "memory", value: 3 },
      ]),
      log(DEVICE_B, [
        header(0, {
          continues: { [DEVICE_A]: 3 },
          device: DEVICE_B,
          id: chatSession,
        }),
        messageRecord(1, user(9)),
        partRecord(2, text(2, 7, "from b")),
      ]),
      file(settingsFileName(DEVICE_B), [
        {
          t: "set",
          seq: 0,
          at: at(2),
          session: chatSession,
          field: "archived",
          value: true,
          device: DEVICE_B,
        },
      ]),
    ];
    const random = createRandom(7);

    for (let round = 0; round < 50; round++) {
      const fold = new ChatFold();
      const delivered = new Map(files.map(({ name }) => [name, 0]));
      while ([...delivered].some(([name, size]) => size < sizeOf(name))) {
        const { bytes, name } = random.pick(files);
        const size = Math.min(
          bytes.length,
          (delivered.get(name) ?? 0) + random.int(1, 120),
        );
        delivered.set(name, size);
        fold.add(name, bytes.subarray(fold.cursor(name).offset, size));

        expect(fold.chat()).toEqual(
          foldChat(
            files.map((each) => ({
              ...each,
              bytes: each.bytes.subarray(0, delivered.get(each.name)),
            })),
          ),
        );
      }
      expect(fold.chat()).toEqual(foldChat(files));
    }

    function sizeOf(name: string) {
      return files.find((each) => each.name === name)?.bytes.length ?? 0;
    }
  });
});
