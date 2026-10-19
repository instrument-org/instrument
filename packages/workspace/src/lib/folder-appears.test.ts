import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { afterFolderAppears } from "./folder-appears";

// A parent watcher that never reports anything, as one whose stream had not
// started yet when the folder was made, or one that failed.
const deaf = vi.hoisted(() => ({ on: false, watchers: [] as EventEmitter[] }));
vi.mock(import("node:fs"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    watch: ((...args: Parameters<typeof original.watch>) => {
      if (!deaf.on) {
        return original.watch(...args);
      }
      const watcher = Object.assign(new EventEmitter(), { close: () => {} });
      deaf.watchers.push(watcher);
      return watcher;
    }) as typeof original.watch,
  };
});

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "folder-appears-"));
  deaf.on = true;
  deaf.watchers = [];
});

afterEach(async () => {
  deaf.on = false;
  await fs.rm(root, { force: true, recursive: true });
});

it("finds a folder its parent's watcher never reported", async () => {
  const dir = path.join(root, "Skills");
  const appeared = vi.fn();
  const stop = afterFolderAppears(dir, appeared);
  try {
    await fs.mkdir(dir);
    await vi.waitFor(() => expect(appeared).toHaveBeenCalledOnce(), {
      interval: 100,
      timeout: 5000,
    });
  } finally {
    stop();
  }
});

it("keeps looking once its parent's watcher fails", async () => {
  const dir = path.join(root, "Memory");
  const appeared = vi.fn();
  const stop = afterFolderAppears(dir, appeared);
  try {
    deaf.watchers[0]?.emit("error", new Error("watcher failed"));
    await fs.mkdir(dir);
    await vi.waitFor(() => expect(appeared).toHaveBeenCalledOnce(), {
      interval: 100,
      timeout: 5000,
    });
  } finally {
    stop();
  }
});
