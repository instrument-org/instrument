import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { withTempDir } from "../../test/helpers/temp-dir";
import { logFileName, marksFileName } from "./file-names";
import { openLog, openMarks } from "./open-log";
import { readLog, readMarks } from "./read-records";
import { RecordWriter, tailHash } from "./record-writer";
import {
  at,
  CHAT,
  DEVICE_A,
  messageId,
  partId,
  sessionId,
  textPart,
  userMessage,
} from "./test-records";

const dir = withTempDir("records-writer");

const session = sessionId(1);
const HEADER = {
  app: "0.0.0-test",
  chat: CHAT,
  createdAt: at(0),
  device: DEVICE_A,
  id: session,
};

function open() {
  return openLog({ dir: dir.path, header: HEADER });
}

async function logRecords(name = logFileName(session, DEVICE_A)) {
  const read = readLog(await fs.readFile(path.join(dir.path, name)));
  return read.kind === "read"
    ? {
        records: read.records.map(({ record }) => record),
        skipped: read.skipped,
      }
    : { records: [], skipped: Number.NaN };
}

function message(n: number) {
  return {
    t: "message" as const,
    at: at(n),
    message: userMessage(session, messageId(n), at(n)),
  };
}

function part(n: number, text: string) {
  return {
    t: "part" as const,
    at: at(n),
    part: textPart(session, messageId(n), partId(n), text, at(n)),
  };
}

describe("RecordWriter", () => {
  it("starts a log with its header and counts seq from it", async () => {
    const log = await open();
    await expect(log.append(message(1))).resolves.toBe(1);
    await expect(log.append(part(1, "hi"))).resolves.toBe(2);

    const { records, skipped } = await logRecords();
    expect(skipped).toBe(0);
    expect(records.map(({ seq, t }) => [seq, t])).toEqual([
      [0, "session"],
      [1, "message"],
      [2, "part"],
    ]);
  });

  it("never interleaves the lines of many callers appending at once", async () => {
    const log = await open();
    const sizes = [1, 10, 1000, 70_000, 200_000];
    const seqs = await Promise.all(
      Array.from({ length: 200 }, (_, n) =>
        log.append(part(n + 1, "x".repeat(sizes[n % sizes.length] ?? 1))),
      ),
    );

    expect(seqs.toSorted((a, b) => a - b)).toEqual(
      Array.from({ length: 200 }, (_, n) => n + 1),
    );
    const { records, skipped } = await logRecords();
    expect(skipped).toBe(0);
    expect(records).toHaveLength(201);
    expect(
      records
        .slice(1)
        .map((record) =>
          record.t === "part" && record.part.type === "text"
            ? record.part.text.length
            : 0,
        ),
    ).toEqual(seqs.map((_, n) => sizes[n % sizes.length]));
  });

  it("carries seq on from the file when the app opens it again", async () => {
    const before = await open();
    await before.append(message(1));
    await before.append(message(2));

    const after = await open();
    await expect(after.append(message(3))).resolves.toBe(3);
    expect(after.path).toBe(before.path);
  });

  it("gives a line a crash cut short its newline before the next one", async () => {
    const log = await open();
    await log.append(message(1));
    await fs.appendFile(log.path, '{"t":"message","seq":2,"at":"2026-');

    const reopened = await open();
    await expect(reopened.append(message(3))).resolves.toBe(2);

    const { records, skipped } = await logRecords();
    expect(skipped).toBe(1);
    expect(records.map(({ seq }) => seq)).toEqual([0, 1, 2]);
  });

  it("tells its hook where each write went, the header and a repair included", async () => {
    const writes: { bytes: Buffer; offset: number }[] = [];
    const onWrite = (bytes: Uint8Array, offset: number) => {
      writes.push({ bytes: Buffer.from(bytes), offset });
    };
    const log = await openLog({ dir: dir.path, header: HEADER, onWrite });
    await log.append(message(1));
    await fs.appendFile(log.path, '{"t":"message","seq":2,"at":"2026-');
    const reopened = await openLog({ dir: dir.path, header: HEADER, onWrite });
    await reopened.append(message(3));

    const file = await fs.readFile(log.path);
    for (const { bytes, offset } of writes) {
      expect(file.subarray(offset, offset + bytes.length)).toEqual(bytes);
    }
    expect(
      writes.map(({ bytes }) => {
        const text = bytes.toString();
        return text === "\n"
          ? "repair"
          : z.object({ t: z.string() }).parse(JSON.parse(text)).t;
      }),
    ).toEqual(["session", "message", "repair", "message"]);
  });

  it("loses only the lines a power cut took before they were synced", async () => {
    const log = await open();
    await log.append(message(1));
    await log.commit();
    await log.append(message(2));
    // What a disk can hold after power fails between a write and its sync:
    // the first part of the last line.
    const { size } = await fs.stat(log.path);
    await fs.truncate(log.path, size - 20);

    const reopened = await open();
    await expect(reopened.append(message(3))).resolves.toBe(2);

    const { records, skipped } = await logRecords();
    expect(skipped).toBe(1);
    expect(
      records.map((record) =>
        record.t === "message" ? record.message.id : record.t,
      ),
    ).toEqual(["session", messageId(1), messageId(3)]);
  });

  it("syncs once for commits that queue together, and not for nothing", async () => {
    const log = await open();
    await log.commit();
    const handle = await fs.open(log.path, "r");
    const sync = vi.spyOn(Object.getPrototypeOf(handle), "sync");
    await handle.close();

    await log.commit();
    expect(sync).not.toHaveBeenCalled();

    await Promise.all([
      log.append(message(1)),
      log.commit(),
      log.append(message(2)),
      log.commit(),
      log.commit(),
    ]);
    expect(sync).toHaveBeenCalledTimes(1);
    sync.mockRestore();
  });

  it("closes the file once a burst is written", async () => {
    const log = await open();
    const handles: FileHandle[] = [];
    const realOpen = fs.open;
    const opened = vi
      .spyOn(fs, "open")
      .mockImplementation(async (...args: Parameters<typeof fs.open>) => {
        const handle = await realOpen(...args);
        handles.push(handle);
        return handle;
      });
    await Promise.all([log.append(message(1)), log.append(message(2))]);
    await log.append(message(3));
    opened.mockRestore();

    expect(handles.length).toBeGreaterThan(0);
    // A closed handle has no descriptor left. The close comes just after the
    // burst's last write resolves.
    await vi.waitFor(() => {
      expect(handles.map((handle) => handle.fd)).toEqual(handles.map(() => -1));
    });
  });

  it("answers with a cursor that matches the file", async () => {
    const log = await open();
    await log.append(message(1));

    const bytes = await fs.readFile(log.path);
    expect(log.cursor()).toEqual({
      lastSeq: 1,
      size: bytes.length,
      tailHash: tailHash(bytes),
    });
  });

  it("refuses a record that would not read back, and writes nothing", async () => {
    const log = await open();
    // A date JSON cannot hold, as a caller with a bad clock would hand over.
    const broken = {
      ...message(1),
      message: userMessage(session, messageId(1), new Date(Number.NaN)),
    };

    await expect(log.append(broken)).rejects.toThrow(/would not read back/);
    expect((await logRecords()).records).toHaveLength(1);
  });

  it("keeps a header first and marks out of logs", async () => {
    const file = path.join(dir.path, "raw.jsonl");
    const writer = new RecordWriter(file, "log", {
      bytes: new Uint8Array(),
      lastSeq: -1,
    });
    await expect(writer.append(message(1))).rejects.toThrow(/no header/);
    await expect(
      writer.append({
        t: "mark",
        at: at(1),
        session,
        field: "starred",
        value: true,
        device: DEVICE_A,
      }),
    ).rejects.toThrow(/does not belong/);
  });
});

describe("openMarks", () => {
  it("appends marks with seq carried on across opens", async () => {
    const star = {
      t: "mark" as const,
      at: at(1),
      session,
      field: "starred" as const,
      value: true,
      device: DEVICE_A,
    };
    const first = await openMarks(dir.path, DEVICE_A);
    await expect(first.append(star)).resolves.toBe(0);
    const second = await openMarks(dir.path, DEVICE_A);
    await expect(second.append({ ...star, value: false })).resolves.toBe(1);

    const read = readMarks(
      await fs.readFile(path.join(dir.path, marksFileName(DEVICE_A))),
    );
    expect(read.records.map(({ record }) => record.value)).toEqual([
      true,
      false,
    ]);
  });
});
