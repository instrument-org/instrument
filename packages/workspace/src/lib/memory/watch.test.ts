import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { publisher } from "../../rpc/publisher";
import { WorkspaceDirSchema } from "../../schemas/paths";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { memoryDir } from "./store";
import { startWatchingMemory } from "./watch";

let root: string;

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

it("waits for a missing memory folder without making it, then publishes", async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "memory-watch-"));
  createMockChatConfigForDir(path.join(root, "tasks", "memory-watch"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(root),
  });
  const heard = vi.fn();
  const controller = new AbortController();
  void (async () => {
    for await (const _ of publisher.subscribe("memory.changed", {
      signal: controller.signal,
    })) {
      heard();
    }
  })().catch(() => undefined);

  const stop = await startWatchingMemory();
  try {
    await expect(fs.stat(memoryDir())).rejects.toThrow();
    await fs.mkdir(memoryDir());
    // The folder can go unreported by its parent's watcher, and is then found
    // by the look each second, which a loaded machine can stretch.
    await vi.waitFor(
      () => {
        expect(heard).toHaveBeenCalled();
      },
      { interval: 100, timeout: 10_000 },
    );
  } finally {
    controller.abort();
    stop();
  }
}, 15_000);
