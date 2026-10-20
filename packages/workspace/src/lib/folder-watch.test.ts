import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stopWatchingFolders, watchFolder } from "./folder-watch";

/**
 * What a watch of one of the person's folders reports: real changes, by
 * anyone, once each, through a folder going away and coming back.
 */
let root: string;
let dir: string;

beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "folder-watch-")),
  );
  dir = path.join(root, "Skills");
});

afterEach(async () => {
  stopWatchingFolders();
  await fs.rm(root, { force: true, recursive: true });
});

/** Counts the changes heard, and waits for the next one. */
function listen(options: { depth?: number; recheckMs?: number } = {}) {
  let heard = 0;
  let waiting: (() => void) | undefined;
  const stop = watchFolder(dir, {
    ...options,
    onChange: () => {
      heard += 1;
      waiting?.();
    },
  });
  return {
    get heard() {
      return heard;
    },
    next: (timeoutMs = 4000) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("no change heard"));
        }, timeoutMs);
        waiting = () => {
          clearTimeout(timer);
          waiting = undefined;
          resolve();
        };
      }),
    stop,
  };
}

/** Long enough for the first read and the watchers behind it. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 600));

async function write(relative: string, text: string) {
  const file = path.join(dir, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

describe("watchFolder", () => {
  it("hears a file saved in an item's folder, and not a save that changed nothing", async () => {
    await write("tidy/SKILL.md", "one\n");
    const watch = listen();
    await settled();

    const changed = watch.next();
    await write("tidy/SKILL.md", "two\n");
    await changed;

    // The same bytes again, with a new time.
    await write("tidy/SKILL.md", "two\n");
    await settled();
    expect(watch.heard).toBe(1);
  });

  it("finds a change deeper than it watches on its regular read", async () => {
    await write("tidy/SKILL.md", "one\n");
    const watch = listen({ depth: 0, recheckMs: 300 });
    await settled();

    const changed = watch.next();
    await write("tidy/scripts/run.sh", "echo\n");
    await expect(changed).resolves.toBeUndefined();
  });

  it("waits for a folder not made yet, and for one removed and made again", async () => {
    const watch = listen();
    await settled();

    const made = watch.next();
    await write("tidy/SKILL.md", "one\n");
    await made;

    const removed = watch.next();
    await fs.rm(dir, { force: true, recursive: true });
    await removed;

    const remade = watch.next();
    await write("brief/SKILL.md", "brief\n");
    await expect(remade).resolves.toBeUndefined();
  });

  it("skips what an install leaves", async () => {
    await write("web/SKILL.md", "web\n");
    const watch = listen({ recheckMs: 300 });
    await settled();

    await write("web/node_modules/left-pad/index.js", "x\n");
    await write("web/.git/HEAD", "ref\n");
    await settled();
    expect(watch.heard).toBe(0);
  });

  it("keeps one watch for every listener, until the last stops", async () => {
    await write("tidy/SKILL.md", "one\n");
    const first = listen();
    const second = listen();
    await settled();
    first.stop();

    const changed = second.next();
    await write("tidy/SKILL.md", "two\n");
    await changed;
    expect(first.heard).toBe(0);
  });
});
