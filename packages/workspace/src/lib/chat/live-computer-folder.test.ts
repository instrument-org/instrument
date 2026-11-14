import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { type ComputerFolder, type ComputerFolderEvent } from "./computer";
import { applyFolderPatch } from "./computer-folder-patch";
import { liveComputerFolder } from "./live-computer-folder";

const chatId = createMockChatConfig(ChatIdSchema.parse("live-computer-folder"));

/** Long enough that a test's change is heard by the watch, not found by the check. */
const QUIET = {
  checkMs: 60_000,
  mostWaitMs: 300,
  pollMs: 60_000,
  settleMs: 40,
};

let folder: string;
let stops: (() => Promise<void>)[] = [];

beforeEach(async () => {
  folder = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "live-computer-folder-")),
  );
});

afterEach(async () => {
  await Promise.all(stops.map((stop) => stop()));
  stops = [];
  await fs.rm(folder, { force: true, recursive: true });
});

/**
 * A live listing of the test's folder, with the folder as the events so far
 * make it, and each event kept.
 */
async function follow(
  options: Partial<Parameters<typeof liveComputerFolder>[0]> = {},
) {
  const controller = new AbortController();
  const events = liveComputerFolder({
    chatId,
    path: folder,
    signal: controller.signal,
    timing: QUIET,
    ...options,
  });
  const state: { events: ComputerFolderEvent[]; folder?: ComputerFolder } = {
    events: [],
  };
  let pending: Promise<IteratorResult<ComputerFolderEvent>> | undefined;
  const take = async () => {
    pending ??= events.next();
    const result = await pending;
    pending = undefined;
    if (result.done) {
      throw new Error("the listing ended");
    }
    state.events.push(result.value);
    state.folder = applyFolderPatch(state.folder, result.value);
  };
  stops.push(async () => {
    controller.abort();
    await pending?.catch(() => undefined);
    await events.return(undefined);
  });
  await take();
  // The loop opens its watch once asked for the next event, and macOS starts
  // a watch's stream on another thread after `watch` returns.
  pending = events.next();
  await new Promise((resolve) => setTimeout(resolve, 300));
  return {
    names: () =>
      state.folder?.kind === "listing"
        ? state.folder.entries.map((entry) => entry.name)
        : [],
    state,
    /** Takes events until `done` holds for the folder they make. */
    async until(done: (folder: ComputerFolder | undefined) => boolean) {
      const deadline = Date.now() + 5000;
      while (!done(state.folder)) {
        if (Date.now() > deadline) {
          throw new Error(`gave up waiting: ${JSON.stringify(state.folder)}`);
        }
        await take();
      }
    },
    take,
  };
}

const entry = (shown: ComputerFolder | undefined, name: string) =>
  shown?.kind === "listing"
    ? shown.entries.find((candidate) => candidate.name === name)
    : undefined;

describe("liveComputerFolder", () => {
  it("sends the folder whole, then a new file as one entry", async () => {
    await fs.writeFile(path.join(folder, "existing.txt"), "a");
    const live = await follow();
    expect(live.state.events[0]?.kind).toBe("snapshot");
    expect(live.names()).toEqual(["existing.txt"]);

    await fs.writeFile(path.join(folder, "new.txt"), "x");
    await live.until((now) => entry(now, "new.txt") !== undefined);

    const patch = live.state.events.at(-1);
    expect(patch?.kind).toBe("patch");
    expect(
      patch?.kind === "patch" && patch.upserts.map((upsert) => upsert.name),
    ).toEqual(["new.txt"]);
    expect(live.state.folder).toMatchObject({ total: 2 });
  });

  it("sends a file being written with its new size", async () => {
    await fs.writeFile(path.join(folder, "growing.txt"), "a");
    const live = await follow();
    await fs.appendFile(path.join(folder, "growing.txt"), "more");
    await live.until((now) => entry(now, "growing.txt")?.size === 5);
    expect(entry(live.state.folder, "growing.txt")?.size).toBe(5);
  });

  it("takes out a file removed, and counts one fewer", async () => {
    await fs.writeFile(path.join(folder, "a.txt"), "a");
    await fs.writeFile(path.join(folder, "b.txt"), "b");
    const live = await follow();
    await fs.rm(path.join(folder, "a.txt"));
    await live.until((now) => entry(now, "a.txt") === undefined);
    expect(live.names()).toEqual(["b.txt"]);
    expect(live.state.folder).toMatchObject({ total: 1 });
  });

  it("follows a rename and a save made through a temporary file", async () => {
    await fs.writeFile(path.join(folder, "draft.txt"), "a");
    await fs.writeFile(path.join(folder, "notes.txt"), "a");
    const live = await follow();
    await fs.rename(
      path.join(folder, "draft.txt"),
      path.join(folder, "final.txt"),
    );
    await fs.writeFile(path.join(folder, ".notes.tmp"), "saved");
    await fs.rename(
      path.join(folder, ".notes.tmp"),
      path.join(folder, "notes.txt"),
    );
    await live.until(
      (now) =>
        entry(now, "final.txt") !== undefined &&
        entry(now, "notes.txt")?.size === 5,
    );
    expect(live.names()).toEqual(["final.txt", "notes.txt"]);
  });

  it("takes in a burst too large to name by reading the folder whole", async () => {
    const live = await follow();
    await Promise.all(
      Array.from({ length: 600 }, (_, index) =>
        fs.writeFile(path.join(folder, `burst-${index}.txt`), "x"),
      ),
    );
    await live.until(
      (now) => now?.kind === "listing" && now.entries.length === 600,
    );
    expect(live.state.folder).toMatchObject({ total: 600 });
  });

  it("ends with the error a read gives once the folder is removed", async () => {
    await fs.writeFile(path.join(folder, "a.txt"), "a");
    const live = await follow();
    await fs.rm(folder, { recursive: true });
    await expect(live.until(() => false)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  describe("what a watch can do wrong", () => {
    /** A watch the test speaks for, counting how often it was opened and closed. */
    function standIn() {
      const watch = {
        closed: 0,
        opened: 0,
        say: (_filename: null | string) => {},
      };
      return {
        watch,
        option: (
          _dir: string,
          listener: (event: string, filename: null | string) => void,
        ) => {
          watch.opened += 1;
          watch.say = (filename) => listener("rename", filename);
          return {
            close: () => {
              watch.closed += 1;
            },
            on: () => undefined,
          };
        },
      };
    }

    it("reads the folder whole when the system loses the names", async () => {
      const { option, watch } = standIn();
      const live = await follow({ watch: option });
      await fs.writeFile(path.join(folder, "unheard.txt"), "x");
      watch.say(null);
      await live.until((now) => entry(now, "unheard.txt") !== undefined);
      expect(entry(live.state.folder, "unheard.txt")).toBeDefined();
    });

    it("closes the watch at once when the system names the folder itself, then watches again", async () => {
      const { option, watch } = standIn();
      const live = await follow({ watch: option });
      await fs.writeFile(path.join(folder, "after.txt"), "x");
      // Windows names a removed folder by its full path, as fast as it can.
      watch.say(folder);
      expect(watch.closed).toBe(1);
      await live.until((now) => entry(now, "after.txt") !== undefined);
      // The loop opens the watch again on its way to the next event.
      live.take().catch(() => undefined);
      await expect.poll(() => watch.opened).toBe(2);
    });

    it("finds what a silent watch missed by looking at the folder, and watches it again", async () => {
      const { option, watch } = standIn();
      const live = await follow({
        timing: { ...QUIET, checkMs: 100 },
        watch: option,
      });
      await fs.writeFile(path.join(folder, "missed.txt"), "x");
      await live.until((now) => entry(now, "missed.txt") !== undefined);
      expect(entry(live.state.folder, "missed.txt")).toBeDefined();
      live.take().catch(() => undefined);
      await expect.poll(() => watch.opened).toBe(2);
    });

    it("reads a folder whole on a clock when it cannot be watched", async () => {
      const live = await follow({
        timing: { ...QUIET, pollMs: 100 },
        watch: () => {
          throw Object.assign(new Error("too many watches"), {
            code: "EMFILE",
          });
        },
      });
      await fs.writeFile(path.join(folder, "polled.txt"), "x");
      await live.until((now) => entry(now, "polled.txt") !== undefined);
      expect(entry(live.state.folder, "polled.txt")).toBeDefined();
    });
  });
});
