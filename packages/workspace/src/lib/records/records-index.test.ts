import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withTempDir } from "../../test/helpers/temp-dir";
import { makeActivityTable } from "../activity/store";
import { openWorkspaceDb } from "../workspace-db";
import { type Delivery, planDeliveries, simulateChat } from "./fake-sync";
import { logFileName, settingsFileName } from "./file-names";
import { type FoldedChat, foldChat } from "./fold";
import { recordLine } from "./record";
import { indexChat } from "./records-index";
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
  partId,
  partRecord,
  sessionId,
  textPart,
  userMessage,
} from "./test-records";

/**
 * The records index against the folders it reads: a fake sync engine
 * delivers chats every way it can, and the index brought up to date after
 * each delivery has to come to the rows a rebuild from the finished folder
 * makes, and to what a fold of the same files says.
 */

const temp = withTempDir("records-index");

const SEEDS = 40;

/** Whether this file system keeps a file's bytes as a hole, which is how a placeholder for a file not downloaded looks. */
const SPARSE = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sparse-"));
  try {
    const file = path.join(dir, "hole");
    fs.writeFileSync(file, "");
    fs.truncateSync(file, 8192);
    return fs.statSync(file).blocks === 0;
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
})();

/** A JSON column's value. */
function json(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : null;
}

function memoryDb(): DatabaseSync {
  return openWorkspaceDb(":memory:").database;
}

function chatDir(): string {
  const dir = path.join(temp.path, "chats", CHAT);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Every index table's rows, in a fixed order. */
function dump(database: DatabaseSync) {
  const all = (sql: string) => database.prepare(sql).all();
  return {
    chats: all("SELECT * FROM chats ORDER BY id"),
    files: all("SELECT * FROM files ORDER BY chat, name"),
    messages: all("SELECT * FROM messages ORDER BY chat, file, id"),
    sessions: all("SELECT * FROM sessions ORDER BY chat, id"),
  };
}

/** The index of the folder as it is, built from nothing. */
async function rebuilt(dir: string) {
  const database = memoryDb();
  await indexChat(database, CHAT, dir);
  const rows = dump(database);
  database.close();
  return rows;
}

/** Writes a placeholder for a file not downloaded: its size, and no bytes on disk. */
function placeholder(file: string, size: number) {
  fs.writeFileSync(file, "");
  fs.truncateSync(file, size);
}

/**
 * What the index says of each session, in the fold's terms: its messages
 * (those with a message record, less what was retracted) and the newest of
 * what replaces itself.
 */
function indexedSessions(database: DatabaseSync) {
  return database
    .prepare("SELECT * FROM sessions WHERE chat = ? ORDER BY id")
    .all(CHAT)
    .map((row) => {
      const ids = json(row.retracted);
      const retracted = new Set<unknown>(Array.isArray(ids) ? ids : []);
      const messages = database
        .prepare(
          "SELECT DISTINCT id FROM messages WHERE chat = ? AND session = ? AND role IS NOT NULL ORDER BY id",
        )
        .all(CHAT, typeof row.id === "string" ? row.id : null)
        .map(({ id }) => id)
        .filter((id) => !retracted.has(id));
      return {
        createdAt: row.created_at,
        forked: row.forked === 1,
        forkedAt: row.forked_at,
        handle: row.handle,
        id: row.id,
        marks: json(row.marks),
        messages,
        parent: row.parent,
        rollover: json(row.rollover),
        stopped: json(row.stopped),
        title: row.title,
        state: json(row.state),
        updatedAt: row.updated_at,
      };
    });
}

/** The same, from a fold. */
function foldedSessions(chat: FoldedChat) {
  return chat.sessions.map((session) => ({
    createdAt: session.createdAt.getTime(),
    forked: session.forked,
    forkedAt: session.forkedAt ?? null,
    handle: session.handle ?? null,
    id: session.id,
    marks: Object.fromEntries(
      Object.values(session.settings)
        .toSorted((a, b) => (a.field < b.field ? -1 : 1))
        .map((mark) => [
          mark.field,
          { at: mark.at.toISOString(), value: mark.value },
        ]),
    ),
    messages: session.messages.map(({ id }) => id),
    parent: session.parent ?? null,
    rollover: session.rollover ?? null,
    stopped: session.stopped
      ? { at: session.stopped.at.toISOString(), by: session.stopped.by }
      : null,
    title: session.title ?? null,
    state: session.state,
    updatedAt: session.updatedAt.getTime(),
  }));
}

/**
 * Puts one delivery on disk the way the fake sync engine's folder holds it:
 * a file as far as it has arrived, and an evicted one as a placeholder of
 * the size it had, where this file system can make one.
 */
function deliver(
  dir: string,
  truth: Map<string, Uint8Array>,
  folder: { evicted: Set<string>; files: Map<string, Uint8Array> },
  delivery: Delivery,
) {
  const name = delivery.kind === "copy" ? delivery.copy : delivery.name;
  const file = path.join(dir, name);
  const held = folder.files.get(name);
  if (delivery.kind === "evict") {
    if (held && SPARSE) {
      folder.evicted.add(name);
      placeholder(file, held.length);
    }
    return;
  }
  if (delivery.kind === "again") {
    if (held && !folder.evicted.has(name)) {
      fs.writeFileSync(file, held);
    }
    return;
  }
  const bytes = (truth.get(delivery.name) ?? new Uint8Array()).subarray(
    0,
    delivery.size,
  );
  if ((held?.length ?? -1) < bytes.length) {
    folder.files.set(name, bytes);
  }
  folder.evicted.delete(name);
  fs.writeFileSync(file, folder.files.get(name) ?? new Uint8Array());
}

function forEachSeed(count: number, check: (seed: number) => Promise<void>) {
  return (async () => {
    for (let seed = 1; seed <= count; seed++) {
      try {
        await check(seed);
      } catch (error) {
        if (error instanceof Error) {
          error.message = `seed ${seed}: ${error.message}`;
        }
        throw error;
      }
    }
  })();
}

describe("indexChat", { timeout: 60_000 }, () => {
  it("comes to the sessions a fold of the same files does", async () => {
    await forEachSeed(SEEDS, async (seed) => {
      const { files } = simulateChat(createRandom(seed));
      const dir = chatDir();
      fs.rmSync(dir, { force: true, recursive: true });
      fs.mkdirSync(dir);
      for (const [name, bytes] of files) {
        fs.writeFileSync(path.join(dir, name), bytes);
      }
      const database = memoryDb();
      await indexChat(database, CHAT, dir);

      const chat = foldChat(
        [...files].map(([name, bytes]) => ({ bytes, name })),
      );
      expect(indexedSessions(database)).toEqual(foldedSessions(chat));
      const own = chat.sessions.find((session) => !session.parent);
      expect(
        database.prepare("SELECT id, session, tasks FROM chats").all(),
      ).toEqual(
        own
          ? [
              {
                id: CHAT,
                session: own.id,
                tasks: chat.sessions.filter(
                  (session) => session.parent === own.id,
                ).length,
              },
            ]
          : [],
      );
      database.close();
    });
  });

  it("comes to the rows a rebuild makes, brought up to date after every delivery", async () => {
    let compared = 0;
    await forEachSeed(SEEDS, async (seed) => {
      // Every seed's index is compared with a rebuild once it has taken the
      // whole folder; the first few are compared after each delivery too.
      // That check is the expensive half (a rebuild reads the folder whole,
      // and there are about forty-six deliveries a seed), and on a slow disk
      // doing it for all forty took the test past a minute under a parallel
      // run while finding nothing the first few do not.
      const afterEachDelivery = seed <= 10;
      const { files } = simulateChat(createRandom(seed));
      const dir = chatDir();
      fs.rmSync(dir, { force: true, recursive: true });
      fs.mkdirSync(dir);
      const database = memoryDb();
      const folder = {
        evicted: new Set<string>(),
        files: new Map<string, Uint8Array>(),
      };
      for (const delivery of planDeliveries(
        createRandom(seed + 10_000),
        files,
      )) {
        deliver(dir, files, folder, delivery);
        await indexChat(database, CHAT, dir);
        // With nothing waiting to download, the folder says all there is.
        if (afterEachDelivery && folder.evicted.size === 0) {
          expect(dump(database)).toEqual(await rebuilt(dir));
          compared += 1;
        }
      }
      expect(dump(database)).toEqual(await rebuilt(dir));
      database.close();
    });
    expect(compared).toBeGreaterThan(SEEDS * 5);
  });

  it("reads only what a file grew by, so a change before its last bytes waits for a rebuild", async () => {
    const dir = chatDir();
    const session = sessionId(1);
    const name = logFileName(session, DEVICE_A);
    const lines = [recordLine(header(0, { device: DEVICE_A, id: session }))];
    for (let n = 1; n <= 60; n++) {
      const message = messageId(n);
      lines.push(
        recordLine(
          messageRecord(lines.length, userMessage(session, message, at(n))),
        ),
      );
    }
    fs.writeFileSync(path.join(dir, name), lines.join(""));
    const database = memoryDb();
    await indexChat(database, CHAT, dir);

    // The first message's line, well before the last 4 KB, broken in place.
    const bytes = fs.readFileSync(path.join(dir, name));
    const first = bytes.indexOf("msg_");
    bytes[first] = "X".charCodeAt(0);
    fs.writeFileSync(
      path.join(dir, name),
      Buffer.concat([
        bytes,
        Buffer.from(
          recordLine(
            messageRecord(
              lines.length,
              userMessage(session, messageId(61), at(61)),
            ),
          ),
        ),
      ]),
    );
    await indexChat(database, CHAT, dir);

    expect(indexedSessions(database)[0]?.messages).toHaveLength(61);
    // Read from its start, the broken line is skipped.
    const fromScratch = memoryDb();
    await indexChat(fromScratch, CHAT, dir);
    expect(indexedSessions(fromScratch)[0]?.messages).toHaveLength(60);
    fromScratch.close();
    database.close();
  });

  it("folds a file again from its start when it got shorter or its end changed", async () => {
    const dir = chatDir();
    const session = sessionId(1);
    const name = logFileName(session, DEVICE_A);
    const file = path.join(dir, name);
    const message = messageId(2);
    const lines = [
      recordLine(header(0, { device: DEVICE_A, id: session })),
      recordLine(messageRecord(1, userMessage(session, message, at(1)))),
      recordLine(
        partRecord(2, textPart(session, message, partId(3), "first", at(1))),
      ),
      recordLine(
        messageRecord(3, assistantMessage(session, messageId(4), at(2))),
      ),
    ];
    fs.writeFileSync(file, lines.join(""));
    const database = memoryDb();
    await indexChat(database, CHAT, dir);

    fs.writeFileSync(file, lines.slice(0, 3).join(""));
    await indexChat(database, CHAT, dir);
    expect(dump(database)).toEqual(await rebuilt(dir));
    expect(indexedSessions(database)[0]?.messages).toEqual([message]);

    // Longer than before, but what it ended with before is gone: another
    // copy of the file took its place.
    const replaced = messageId(5);
    fs.writeFileSync(
      file,
      [
        lines[0],
        recordLine(
          messageRecord(1, assistantMessage(session, replaced, at(3))),
        ),
        recordLine(
          partRecord(
            2,
            textPart(session, replaced, partId(6), "in its place", at(3)),
          ),
        ),
        recordLine(messageRecord(3, userMessage(session, messageId(7), at(4)))),
      ].join(""),
    );
    await indexChat(database, CHAT, dir);
    expect(dump(database)).toEqual(await rebuilt(dir));
    expect(indexedSessions(database)[0]?.messages).toEqual([
      replaced,
      messageId(7),
    ]);
    database.close();
  });

  it("drops a file's rows when it goes, and a chat's when its folder does", async () => {
    const dir = chatDir();
    const session = sessionId(1);
    fs.writeFileSync(
      path.join(dir, logFileName(session, DEVICE_A)),
      recordLine(header(0, { device: DEVICE_A, id: session })),
    );
    fs.writeFileSync(
      path.join(dir, settingsFileName(DEVICE_B)),
      recordLine({
        t: "set",
        seq: 0,
        at: at(5),
        session,
        field: "starred",
        value: true,
        device: DEVICE_B,
      }),
    );
    const database = memoryDb();
    await indexChat(database, CHAT, dir);
    expect(database.prepare("SELECT starred FROM chats").all()).toEqual([
      { starred: 1 },
    ]);

    fs.rmSync(path.join(dir, settingsFileName(DEVICE_B)));
    await indexChat(database, CHAT, dir);
    expect(dump(database)).toEqual(await rebuilt(dir));
    expect(database.prepare("SELECT starred FROM chats").all()).toEqual([
      { starred: 0 },
    ]);

    fs.rmSync(dir, { recursive: true });
    await indexChat(database, CHAT, dir);
    expect(dump(database)).toEqual({
      chats: [],
      files: [],
      messages: [],
      sessions: [],
    });
    database.close();
  });

  describe("a file whose stat reports no blocks behind its bytes", () => {
    const PLATFORM = process.platform;

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: PLATFORM });
      vi.restoreAllMocks();
    });

    /**
     * Stats `file` the way macOS reports one iCloud has not downloaded, and
     * the way NTFS reports one whose bytes live in its MFT record: the size
     * it has, with no blocks behind it.
     */
    function withoutBlocks(file: string): void {
      vi.spyOn(fsPromises, "stat").mockImplementation((target) => {
        const stat = fs.statSync(target);
        if (String(target) === file) {
          stat.blocks = 0;
        }
        return Promise.resolve(stat);
      });
    }

    const session = sessionId(1);
    const name = logFileName(session, DEVICE_A);
    const lines = [
      recordLine(header(0, { device: DEVICE_A, id: session })),
      recordLine(messageRecord(1, userMessage(session, messageId(2), at(1)))),
      recordLine(messageRecord(2, userMessage(session, messageId(3), at(2)))),
    ];
    const upTo = (count: number) => lines.slice(0, count).join("");

    const fileRows = (database: DatabaseSync) =>
      database
        .prepare("SELECT name, downloaded, size FROM files ORDER BY name")
        .all();

    it.each(["darwin", "win32"])("is read on %s", async (platform) => {
      const dir = chatDir();
      const file = path.join(dir, name);
      fs.writeFileSync(file, upTo(3));
      Object.defineProperty(process, "platform", { value: platform });
      withoutBlocks(file);
      const database = memoryDb();
      await indexChat(database, CHAT, dir);

      expect(fileRows(database)).toEqual([
        { downloaded: 1, name, size: upTo(3).length },
      ]);
      expect(indexedSessions(database)[0]?.messages).toEqual([
        messageId(2),
        messageId(3),
      ]);
      database.close();
    });

    it("keeps what it held when the download it asks for fails, and folds it once it arrives", async () => {
      const dir = chatDir();
      const file = path.join(dir, name);
      fs.writeFileSync(file, upTo(2));
      const database = memoryDb();
      await indexChat(database, CHAT, dir);

      // Another device grew it, and iCloud has none of the bytes it grew by:
      // the read asks for them, which offline is a read that fails.
      fs.writeFileSync(file, upTo(3));
      Object.defineProperty(process, "platform", { value: "darwin" });
      withoutBlocks(file);
      const open = vi
        .spyOn(fsPromises, "open")
        .mockRejectedValue(
          Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
        );
      await indexChat(database, CHAT, dir);
      expect(open).toHaveBeenCalledWith(file, "r");
      expect(fileRows(database)).toEqual([
        { downloaded: 0, name, size: upTo(2).length },
      ]);
      expect(indexedSessions(database)[0]?.messages).toEqual([messageId(2)]);

      vi.restoreAllMocks();
      await indexChat(database, CHAT, dir);
      expect(fileRows(database)).toEqual([
        { downloaded: 1, name, size: upTo(3).length },
      ]);
      expect(indexedSessions(database)[0]?.messages).toEqual([
        messageId(2),
        messageId(3),
      ]);
      database.close();
    });

    it("raises a read that fails where no file waits on a download", async () => {
      const dir = chatDir();
      const file = path.join(dir, name);
      fs.writeFileSync(file, upTo(3));
      Object.defineProperty(process, "platform", { value: "win32" });
      withoutBlocks(file);
      vi.spyOn(fsPromises, "open").mockRejectedValue(
        Object.assign(new Error("no reading that"), { code: "EACCES" }),
      );
      const database = memoryDb();
      await expect(indexChat(database, CHAT, dir)).rejects.toThrow(
        "no reading that",
      );
      database.close();
    });
  });

  it("rebuilds its own tables, and nothing else, when their version changes", async () => {
    const dir = chatDir();
    const { files } = simulateChat(createRandom(7));
    for (const [name, bytes] of files) {
      fs.writeFileSync(path.join(dir, name), bytes);
    }
    const file = path.join(temp.path, "workspace.db");
    let database = openWorkspaceDb(file).database;
    makeActivityTable(database);
    database
      .prepare(
        "INSERT INTO activity (id, started_at, status, kind, purpose) VALUES ('req_1', 1, 'finished', 'language', 'chat')",
      )
      .run();
    await indexChat(database, CHAT, dir);
    const indexed = dump(database);
    database.exec("UPDATE sessions SET title = 'changed by hand'");
    database.close();

    // The same version: the hand-made change stands, since nothing grew.
    database = openWorkspaceDb(file).database;
    await indexChat(database, CHAT, dir);
    expect(
      database.prepare("SELECT DISTINCT title FROM sessions").all(),
    ).toEqual([{ title: "changed by hand" }]);
    database.exec("UPDATE meta SET value = '0' WHERE key = 'records-index'");
    database.close();

    database = openWorkspaceDb(file).database;
    await indexChat(database, CHAT, dir);
    expect(dump(database)).toEqual(indexed);
    expect(database.prepare("SELECT id FROM activity").all()).toEqual([
      { id: "req_1" },
    ]);
    database.close();
  });
});
