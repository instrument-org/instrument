import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { withTempDir } from "../../test/helpers/temp-dir";
import { logFileName } from "./file-names";
import { openLog, type OpenLogOptions } from "./open-log";
import { readLog } from "./read-records";
import { type SessionHeader } from "./record";
import {
  at,
  CHAT,
  DEVICE_A,
  DEVICE_B,
  messageId,
  sessionId,
  userMessage,
} from "./test-records";

const dir = withTempDir("records-open-log");

const session = sessionId(1);
const HEADER: OpenLogOptions["header"] = {
  app: "0.0.0-test",
  chat: CHAT,
  createdAt: at(0),
  device: DEVICE_A,
  id: session,
};
const FIRST = logFileName(session, DEVICE_A);
const SECOND = logFileName(session, DEVICE_A, 2);

function message(n: number) {
  return {
    t: "message" as const,
    at: at(n),
    message: userMessage(session, messageId(n), at(n)),
  };
}

/** A log with a header and `count` messages, and the index's cursor for it. */
async function written(count: number) {
  const log = await openLog({ dir: dir.path, header: HEADER });
  for (let n = 1; n <= count; n++) {
    await log.append(message(n));
  }
  return { cursor: log.cursor(), name: path.basename(log.path) };
}

async function headerOf(name: string): Promise<SessionHeader | undefined> {
  const read = readLog(await fs.readFile(path.join(dir.path, name)));
  const first = read.kind === "read" ? read.records[0]?.record : undefined;
  return first?.t === "session" ? first : undefined;
}

describe("openLog", () => {
  it("starts a session's first log with its header", async () => {
    const log = await openLog({ dir: dir.path, header: HEADER });

    expect(path.basename(log.path)).toBe(FIRST);
    expect(await headerOf(FIRST)).toMatchObject({
      ...HEADER,
      format: 1,
      seq: 0,
      t: "session",
    });
    expect(await headerOf(FIRST)).not.toHaveProperty("continues");
  });

  it("carries on in the log the index saw", async () => {
    const last = await written(2);

    const log = await openLog({ dir: dir.path, header: HEADER, last });

    expect(path.basename(log.path)).toBe(FIRST);
    await expect(log.append(message(3))).resolves.toBe(3);
  });

  it.each([
    [
      "shorter than the index saw",
      async (file: string) => {
        const { size } = await fs.stat(file);
        await fs.truncate(file, size - 10);
      },
    ],
    [
      "ending in other bytes",
      async (file: string) => {
        const bytes = await fs.readFile(file);
        bytes[bytes.length - 3] = "X".charCodeAt(0);
        await fs.writeFile(file, bytes);
      },
    ],
  ])(
    "starts the next log when the file is %s, carrying on from what the index saw",
    async (_name, change) => {
      const last = await written(2);
      const before = await fs.readFile(path.join(dir.path, FIRST));
      await change(path.join(dir.path, FIRST));
      const changed = await fs.readFile(path.join(dir.path, FIRST));

      const log = await openLog({ dir: dir.path, header: HEADER, last });

      expect(path.basename(log.path)).toBe(SECOND);
      expect(await headerOf(SECOND)).toMatchObject({
        continues: { [DEVICE_A]: 2 },
      });
      await expect(log.append(message(3))).resolves.toBe(1);
      // The file it did not recognize is left as it found it.
      await expect(fs.readFile(path.join(dir.path, FIRST))).resolves.toEqual(
        changed,
      );
      expect(changed).not.toEqual(before);
    },
  );

  it("goes on to .3 when the .2 is not what the index saw either", async () => {
    const first = await written(1);
    await fs.truncate(path.join(dir.path, FIRST), first.cursor.size - 1);
    const second = await openLog({
      dir: dir.path,
      header: HEADER,
      last: first,
    });
    await second.append(message(2));
    const last = { cursor: second.cursor(), name: path.basename(second.path) };
    await fs.truncate(second.path, last.cursor.size - 1);

    const third = await openLog({ dir: dir.path, header: HEADER, last });

    expect(path.basename(third.path)).toBe(logFileName(session, DEVICE_A, 3));
    expect(await headerOf(logFileName(session, DEVICE_A, 3))).toMatchObject({
      continues: { [`${DEVICE_A}.2`]: 1 },
    });
  });

  it("starts the next log when the file's first line is not its header", async () => {
    await fs.writeFile(path.join(dir.path, FIRST), "something else\n");

    const log = await openLog({ dir: dir.path, header: HEADER });

    expect(path.basename(log.path)).toBe(SECOND);
    expect(await headerOf(SECOND)).not.toHaveProperty("continues");
    await expect(fs.readFile(path.join(dir.path, FIRST), "utf8")).resolves.toBe(
      "something else\n",
    );
  });

  it("starts a log after one another device's conflict copy came from", async () => {
    await written(1);
    await fs.writeFile(
      path.join(dir.path, `${session}.${DEVICE_A}.2 2.jsonl`),
      "",
    );

    const log = await openLog({
      dir: dir.path,
      header: { ...HEADER, continues: { [DEVICE_B]: 4 } },
    });

    expect(path.basename(log.path)).toBe(logFileName(session, DEVICE_A, 3));
  });

  it("starts the next log when the one the index saw is gone", async () => {
    await written(1);
    await fs.writeFile(path.join(dir.path, SECOND), "");
    const last = {
      cursor: { lastSeq: 7, size: 10, tailHash: "" },
      name: SECOND,
    };
    await fs.rm(path.join(dir.path, SECOND));

    const log = await openLog({ dir: dir.path, header: HEADER, last });

    expect(path.basename(log.path)).toBe(logFileName(session, DEVICE_A, 3));
    expect(await headerOf(logFileName(session, DEVICE_A, 3))).toMatchObject({
      continues: { [`${DEVICE_A}.2`]: 7 },
    });
  });

  it("starts the next log once the device has read more of another's", async () => {
    await openLog({
      dir: dir.path,
      header: { ...HEADER, continues: { [DEVICE_B]: 4 } },
    });

    const same = await openLog({
      dir: dir.path,
      header: { ...HEADER, continues: { [DEVICE_A]: 0, [DEVICE_B]: 4 } },
    });
    expect(path.basename(same.path)).toBe(FIRST);

    const next = await openLog({
      dir: dir.path,
      header: { ...HEADER, continues: { [DEVICE_B]: 9 } },
    });
    expect(path.basename(next.path)).toBe(SECOND);
    expect(await headerOf(SECOND)).toMatchObject({
      continues: { [DEVICE_A]: 0, [DEVICE_B]: 9 },
    });
  });
});
