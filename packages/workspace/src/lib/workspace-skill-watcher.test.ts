import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { publisher } from "../rpc/publisher";
import { WorkspaceDirSchema } from "../schemas/paths";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { startWatchingWorkspaceSkills } from "./workspace-skill-watcher";

let root: string;

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

describe("workspace skill watcher", () => {
  it("publishes changes written anywhere under a skill", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-watcher-"));
    createMockTaskConfigForDir(path.join(root, "tasks", "watcher-test"));
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      rootDir: WorkspaceDirSchema.parse(root),
    });

    const controller = new AbortController();
    const events = publisher
      .subscribe("skill.changed", { signal: controller.signal })
      [Symbol.asyncIterator]();
    const nextEvent = events.next();
    const stop = await startWatchingWorkspaceSkills();
    try {
      const skillDir = path.join(root, "skills", "review");
      await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
      await fs.writeFile(path.join(skillDir, "scripts", "run.ts"), "");
      await expect(nextEvent).resolves.toMatchObject({ done: false });
    } finally {
      controller.abort();
      await stop();
    }
  }, 15_000);
});
