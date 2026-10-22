import log from "electron-log/node";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { guardLogger } from "./log-guards";

const writeFailure = (code: string) =>
  Object.assign(new Error(`write ${code}`), { code, syscall: "write" });

let loggerCount = 0;
let clock = 0;

function createGuardedLogger(consoleWrite: () => void = vi.fn()) {
  loggerCount += 1;
  const logger = log.create({ logId: `log-guards-${loggerCount}` });
  logger.transports.file.level = false;
  logger.transports.console.writeFn = consoleWrite;
  const stdout = new EventEmitter();
  const lines: unknown[][] = [];
  logger.transports.capture = Object.assign(
    (message: { data: unknown[] }) => {
      lines.push(message.data);
    },
    { level: "silly" as const, transforms: [] },
  );
  const guards = guardLogger(logger, { now: () => clock, streams: [stdout] });
  return { guards, lines, logger, stdout };
}

describe("guardLogger", () => {
  beforeEach(() => {
    clock = 0;
  });

  // electron-log writes through `console.error`, and Node's console swallows
  // a write that throws; the stream emits the failure as an error event.
  it("stops writing to a terminal whose stream failed", () => {
    const consoleWrite = vi.fn();
    const { logger, stdout } = createGuardedLogger(consoleWrite);

    logger.error("before");
    expect(() => stdout.emit("error", writeFailure("EIO"))).not.toThrow();
    for (let index = 0; index < 100; index += 1) {
      logger.error("after");
    }

    expect(consoleWrite).toHaveBeenCalledOnce();
    expect(logger.transports.console.level).toBe(false);
  });

  it("stops writing to a console whose write threw, rather than failing per line", () => {
    const consoleWrite = vi.fn(() => {
      throw writeFailure("EPIPE");
    });
    const { logger } = createGuardedLogger(consoleWrite);

    for (let index = 0; index < 100; index += 1) {
      logger.error(`failure ${index}`);
    }
    // electron-log also reports its own failures straight to `writeFn`.
    logger.transports.console.writeFn({
      message: {
        data: ["Can't write to main.log"],
        date: new Date(),
        level: "error",
      },
    });

    expect(consoleWrite).toHaveBeenCalledOnce();
  });

  it("rests the log file for a minute after a write to it fails", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "log-guards-"));
    const filePath = path.join(dir, "main.log");
    const { logger } = createGuardedLogger();
    logger.transports.file.level = "info";
    logger.transports.file.sync = true;
    logger.transports.file.resolvePathFn = () => filePath;
    const fileLines = () =>
      fs.readFileSync(filePath, "utf8").trim().split("\n").filter(Boolean);

    try {
      logger.info("first");
      const file = logger.transports.file.getFile();
      // `on` is all the type names; the file is an emitter.
      expect(file).toBeInstanceOf(EventEmitter);
      if (file instanceof EventEmitter) {
        file.emit("error", new Error("Couldn't write to main.log. ENOSPC"));
      }
      for (let index = 0; index < 100; index += 1) {
        logger.info("while full");
      }
      expect(fileLines()).toHaveLength(1);

      clock += 60_000;
      logger.info("a minute later");
      expect(fileLines()).toHaveLength(2);
    } finally {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });

  it("writes one line a bounded number of times, numbers aside, then says how many it held back", () => {
    const { lines, logger } = createGuardedLogger();

    for (let index = 0; index < 100; index += 1) {
      logger.error(`Could not save chat ${index}`);
    }
    expect(lines).toHaveLength(20);

    clock += 10_000;
    logger.error("Could not save chat 100");

    expect(lines.at(-1)).toEqual([
      "Could not save chat 100",
      "(repeated 80 more times)",
    ]);
  });

  it("caps lines of any kind per interval", () => {
    const { lines, logger } = createGuardedLogger();

    for (let index = 0; index < 1500; index += 1) {
      logger.info(
        `line ${String(index).replaceAll(/\d/g, (digit) => "abcdefghij"[Number(digit)] ?? "")}`,
      );
    }

    expect(lines).toHaveLength(1000);
  });
});
