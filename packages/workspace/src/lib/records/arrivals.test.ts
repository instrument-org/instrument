import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Arrival, RecordArrivals } from "./arrivals";
import { ChatRecords } from "./chat-records";
import { planDeliveries, simulateChat } from "./fake-sync";
import { logFileName } from "./file-names";
import { type LogRecord, recordLine } from "./record";
import { createRandom } from "./seeded-random";
import {
  assistantMessage,
  at,
  CHAT,
  DEVICE_A,
  DEVICE_B,
  header,
  messageId,
  messageRecord,
  sessionId,
  userMessage,
} from "./test-records";

const SESSION = sessionId(1);

let chatsDir = "";
let reader: ChatRecords;
let arrived: Arrival[];
let arrivals: RecordArrivals;

function recordsDir(chat: string = CHAT) {
  return path.join(chatsDir, chat);
}

function lines(...records: LogRecord[]) {
  return records.map(recordLine).join("");
}

async function messageIds(records: ChatRecords, session = SESSION) {
  const read = await records.read(CHAT);
  return read.chat.sessions
    .find(({ id }) => id === session)
    ?.messages.map(({ id }) => id);
}

beforeEach(async () => {
  chatsDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "record-arrivals-")),
  );
  reader = new ChatRecords({
    app: "0.0.0-test",
    device: DEVICE_A,
    dirOf: (chatId) => recordsDir(chatId),
    fsync: false,
  });
  arrived = [];
  arrivals = new RecordArrivals({
    chatsDir,
    device: DEVICE_A,
    onArrival: (arrival) => {
      arrived.push(arrival);
    },
    watch: false,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  arrivals.stop();
  await reader.dispose();
  await fs.rm(chatsDir, { force: true, recursive: true });
});

/** Another device's log of the chat's session, with its first message. */
async function otherDeviceStarted() {
  await fs.mkdir(recordsDir(), { recursive: true });
  await fs.writeFile(
    path.join(recordsDir(), logFileName(SESSION, DEVICE_B)),
    lines(
      header(0, { device: DEVICE_B, id: SESSION }),
      messageRecord(1, userMessage(SESSION, messageId(1), at(1))),
    ),
  );
}

describe("another device's records reaching a running app", () => {
  it("folds only what another device's log gained, and names the messages it brought", async () => {
    await otherDeviceStarted();
    await reader.read(CHAT);
    await arrivals.start();
    await fs.appendFile(
      path.join(recordsDir(), logFileName(SESSION, DEVICE_B)),
      lines(messageRecord(2, assistantMessage(SESSION, messageId(2), at(2)))),
    );
    const readFile = vi.spyOn(fs, "readFile");

    await arrivals.look();
    const held = await reader.catchUp(CHAT);

    expect(arrived).toEqual([
      {
        chat: CHAT,
        messages: [{ id: messageId(2), removed: false, sessionId: SESSION }],
        new: false,
        session: false,
        settings: false,
      },
    ]);
    expect(held).toBe(true);
    expect(readFile).not.toHaveBeenCalled();
    expect(await messageIds(reader)).toEqual([messageId(1), messageId(2)]);
  });

  it("folds a log another device started in a chat already held", async () => {
    await otherDeviceStarted();
    await reader.read(CHAT);
    await arrivals.start();
    const task = sessionId(2);
    await fs.writeFile(
      path.join(recordsDir(), logFileName(task, DEVICE_B)),
      lines(
        header(0, { device: DEVICE_B, id: task, parent: SESSION }),
        messageRecord(1, userMessage(task, messageId(3), at(3))),
      ),
    );

    await arrivals.look();
    await reader.catchUp(CHAT);

    expect(arrived.map(({ messages }) => messages)).toEqual([
      [{ id: messageId(3), removed: false, sessionId: task }],
    ]);
    expect(await messageIds(reader, task)).toEqual([messageId(3)]);
  });

  it("folds a sync engine's conflict copy of a log once", async () => {
    await otherDeviceStarted();
    await reader.read(CHAT);
    await arrivals.start();
    const log = path.join(recordsDir(), logFileName(SESSION, DEVICE_B));
    await fs.copyFile(log, log.replace(/\.jsonl$/, " 2.jsonl"));

    await arrivals.look();
    await reader.catchUp(CHAT);

    expect(await messageIds(reader)).toEqual([messageId(1)]);
  });

  it("hears nothing of this device's own writes", async () => {
    await reader.startSession(CHAT, { createdAt: at(0), id: SESSION });
    await arrivals.start();

    await reader.appendMessage(CHAT, userMessage(SESSION, messageId(1), at(1)));
    await arrivals.look();

    expect(arrived).toEqual([]);
  });

  it("says a chat another device started is new, without reading it", async () => {
    await arrivals.start();
    await otherDeviceStarted();

    await arrivals.look();

    expect(arrived).toEqual([
      {
        chat: CHAT,
        messages: [],
        new: true,
        session: false,
        settings: false,
      },
    ]);
  });

  it("starts this device's next log saying it carries on after another device's records", async () => {
    await reader.startSession(CHAT, { createdAt: at(0), id: SESSION });
    await reader.appendMessage(CHAT, userMessage(SESSION, messageId(1), at(1)));
    await fs.writeFile(
      path.join(recordsDir(), logFileName(SESSION, DEVICE_B)),
      lines(
        header(0, {
          continues: { [DEVICE_A]: 1 },
          device: DEVICE_B,
          id: SESSION,
        }),
        messageRecord(1, assistantMessage(SESSION, messageId(2), at(2))),
      ),
    );

    await reader.catchUp(CHAT);
    await reader.appendMessage(CHAT, userMessage(SESSION, messageId(3), at(3)));

    expect((await fs.readdir(recordsDir())).toSorted()).toEqual(
      [
        logFileName(SESSION, DEVICE_A),
        logFileName(SESSION, DEVICE_A, 2),
        logFileName(SESSION, DEVICE_B),
      ].toSorted(),
    );
    const fresh = new ChatRecords({
      app: "0.0.0-test",
      device: DEVICE_A,
      dirOf: (chatId) => recordsDir(chatId),
      fsync: false,
    });
    const [session] = (await fresh.read(CHAT)).chat.sessions;
    expect(session?.forked).toBe(false);
    expect(session?.messages.map(({ id }) => id)).toEqual([
      messageId(1),
      messageId(2),
      messageId(3),
    ]);
    await fresh.dispose();
  });

  it.runIf(process.platform === "darwin" || process.platform === "win32")(
    "looks at a chat when its folder changes, and not for this device's own files",
    async () => {
      await otherDeviceStarted();
      const watching = new RecordArrivals({
        chatsDir,
        device: DEVICE_A,
        onArrival: (arrival) => {
          arrived.push(arrival);
        },
        settleMs: 20,
      });
      await watching.start();
      try {
        await fs.writeFile(
          path.join(recordsDir(), logFileName(SESSION, DEVICE_A)),
          lines(header(0, { device: DEVICE_A, id: SESSION })),
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(arrived).toEqual([]);

        await fs.appendFile(
          path.join(recordsDir(), logFileName(SESSION, DEVICE_B)),
          lines(
            messageRecord(2, assistantMessage(SESSION, messageId(2), at(2))),
          ),
        );

        await vi.waitFor(
          () => {
            expect(arrived.map(({ messages }) => messages)).toEqual([
              [{ id: messageId(2), removed: false, sessionId: SESSION }],
            ]);
          },
          { timeout: 15_000 },
        );
      } finally {
        watching.stop();
      }
    },
    // A real watch on a loaded machine can take seconds to report.
    20_000,
  );
});

describe("a held chat over a fake sync engine", { timeout: 30_000 }, () => {
  it.each(Array.from({ length: 12 }, (_, index) => index + 1))(
    "comes to what a fresh fold of its folder reads, seed %i",
    async (seed) => {
      const { files } = simulateChat(createRandom(seed));
      await fs.mkdir(recordsDir(), { recursive: true });
      const release = await reader.open(CHAT);
      await arrivals.start();
      const written = new Map<string, number>();

      for (const delivery of planDeliveries(
        createRandom(seed + 30_000),
        files,
      )) {
        const name = delivery.kind === "copy" ? delivery.copy : delivery.name;
        const file = path.join(recordsDir(), name);
        if (delivery.kind === "evict") {
          await fs.rm(file, { force: true });
          written.delete(name);
        } else if (delivery.kind === "grow" || delivery.kind === "copy") {
          const bytes = (files.get(delivery.name) ?? new Uint8Array()).subarray(
            0,
            delivery.size,
          );
          if ((written.get(name) ?? -1) < bytes.length) {
            await fs.writeFile(file, bytes);
            written.set(name, bytes.length);
          }
        }
        await arrivals.look([CHAT]);
        await reader.catchUp(CHAT);
      }

      const fresh = new ChatRecords({
        app: "0.0.0-test",
        device: DEVICE_A,
        dirOf: (chatId) => recordsDir(chatId),
        fsync: false,
      });
      expect((await reader.read(CHAT)).chat).toEqual(
        (await fresh.read(CHAT)).chat,
      );
      release();
      await fresh.dispose();
    },
  );
});
