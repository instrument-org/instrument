import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const location = vi.hoisted(() => ({ dir: "" }));
vi.mock("node:path", async (original) => {
  const actual = await original<{ default: typeof path }>();
  return {
    default: {
      ...actual.default,
      join: (...parts: string[]) =>
        parts.at(-1) === ".logs" ? location.dir : actual.default.join(...parts),
    },
  };
});

const streams: fs.WriteStream[] = [];
beforeEach(() => {
  vi.resetModules();
  location.dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-log-"));
  const create = fs.createWriteStream.bind(fs);
  vi.spyOn(fs, "createWriteStream").mockImplementation((...args) => {
    const stream = create(...args);
    streams.push(stream);
    return stream;
  });
});
afterEach(async () => {
  await Promise.all(
    streams.splice(0).map(
      (stream) =>
        new Promise<void>((resolve) => {
          if (stream.closed) {
            resolve();
            return;
          }
          stream.once("close", resolve);
          stream.end();
        }),
    ),
  );
  vi.restoreAllMocks();
  fs.rmSync(location.dir, { recursive: true, force: true });
});

it("prunes oversized historical logs against a total directory budget", async () => {
  for (let index = 0; index < 20; index++) {
    const file = path.join(
      location.dir,
      `2026-01-${String(index + 1).padStart(2, "0")}.jsonl`,
    );
    fs.writeFileSync(file, "");
    fs.truncateSync(file, 32 * 1024 * 1024);
  }
  const logger = await import("./dev-file-logger");
  logger.openDevLog();
  const sizes = fs
    .readdirSync(location.dir)
    .filter((name) => name.startsWith("2026-01-"))
    .map((name) => fs.statSync(path.join(location.dir, name)).size);
  expect(sizes).toHaveLength(3);
  expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(
    120 * 1024 * 1024,
  );
});

it("caps Unicode output at eight MiB while keeping valid JSON lines", async () => {
  const logger = await import("./dev-file-logger");
  logger.openDevLog();
  const stream = streams[0];
  if (!stream) throw new Error("No dev stream");
  for (let index = 0; index < 1000; index++) {
    logger.writeDevLogEntry("error", ["🙂".repeat(8000)]);
    // Let real stream writes drain so this reaches the file cap rather than the queue cap.
    if (stream.writableEnded) break;
    await new Promise<void>((resolve) => stream.write("", () => resolve()));
  }
  if (!stream.closed)
    await new Promise<void>((resolve) => {
      stream.once("close", resolve);
      stream.end();
    });
  const file = logger.getDevLogFilePath();
  if (!file) throw new Error("No dev file");
  const contents = fs.readFileSync(file, "utf8");
  expect(Buffer.byteLength(contents)).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(Buffer.byteLength(contents)).toBeGreaterThan(7 * 1024 * 1024);
  for (const line of contents.trim().split("\n"))
    expect(() => {
      JSON.parse(line);
    }).not.toThrow();
});
