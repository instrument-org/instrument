import parcelWatcher from "@parcel/watcher";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { workspaceLayout } from "./workspace-layout";
import { publisher } from "../rpc/publisher";
import { WorkspaceDirSchema } from "../schemas/paths";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { SKILL_ARTIFACT_WATCHER_IGNORE } from "./skill-artifact-ignore";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import {
  startWatchingWorkspaceSkills,
  stopWorkspaceSkillWatcher,
} from "./workspace-skill-watcher";

let root: string;

afterEach(async () => {
  await stopWorkspaceSkillWatcher();
  await fs.rm(root, { force: true, recursive: true });
});

describe("workspace skill watcher", () => {
  it("publishes changes written anywhere under a skill", async () => {
    root = await setupWorkspace();

    const controller = new AbortController();
    const events = publisher
      .subscribe("skill.changed", { signal: controller.signal })
      [Symbol.asyncIterator]();
    const nextEvent = events.next();
    const stop = await startWatchingWorkspaceSkills();
    try {
      const skillDir = path.join(workspaceLayout(root).skillsDir, "review");
      await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
      await expect(
        writeUntilPublished(path.join(skillDir, "scripts", "run.ts"), nextEvent),
      ).resolves.toMatchObject({ done: false });
    } finally {
      controller.abort();
      await stop();
    }
  }, 15_000);

  it("keeps watching until the final subscriber releases", async () => {
    root = await setupWorkspace();
    const controller = new AbortController();
    const events = publisher
      .subscribe("skill.changed", { signal: controller.signal })
      [Symbol.asyncIterator]();
    const nextEvent = events.next();
    const stopFirst = await startWatchingWorkspaceSkills();
    const stopSecond = await startWatchingWorkspaceSkills();
    try {
      await stopFirst();
      await expect(
        writeUntilPublished(
          path.join(workspaceLayout(root).skillsDir, "kept.md"),
          nextEvent,
        ),
      ).resolves.toMatchObject({ done: false });
    } finally {
      controller.abort();
      await stopSecond();
    }
  }, 15_000);

  it("lets a fresh watcher survive a stale disposer after global shutdown", async () => {
    root = await setupWorkspace();
    const stopStale = await startWatchingWorkspaceSkills();
    await stopWorkspaceSkillWatcher();

    const controller = new AbortController();
    const events = publisher
      .subscribe("skill.changed", { signal: controller.signal })
      [Symbol.asyncIterator]();
    const nextEvent = events.next();
    const stopFresh = await startWatchingWorkspaceSkills();
    try {
      await stopStale();
      await expect(
        writeUntilPublished(
          path.join(workspaceLayout(root).skillsDir, "fresh.md"),
          nextEvent,
        ),
      ).resolves.toMatchObject({ done: false });
    } finally {
      controller.abort();
      await stopFresh();
    }
  }, 15_000);

  it("ignores generated dependency trees", async () => {
    root = await setupWorkspace();
    const { skillsDir } = workspaceLayout(root);
    const watchedSkillsDir = await fs.realpath(skillsDir);
    const generatedDir = path.join(
      skillsDir,
      "review",
      "node_modules",
      "dependency",
    );
    await fs.mkdir(generatedDir, { recursive: true });

    const files: string[] = [];
    const subscription = await parcelWatcher.subscribe(
      watchedSkillsDir,
      (_error, events) => {
        files.push(
          ...events.map((event) => path.relative(watchedSkillsDir, event.path)),
        );
      },
      { ignore: SKILL_ARTIFACT_WATCHER_IGNORE },
    );
    try {
      await fs.writeFile(path.join(generatedDir, "index.js"), "");
      await vi.waitFor(
        async () => {
          // Written on each attempt for the same reason
          // `writeUntilPublished` does it: one change can go unheard, and
          // waiting on a single write that was missed only waits.
          await fs.writeFile(path.join(skillsDir, "review", "SKILL.md"), "");
          expect(files).toContain(path.join("review", "SKILL.md"));
        },
        { interval: 1000, timeout: 10_000 },
      );
      expect(files.some((file) => file.includes("node_modules"))).toBe(false);
    } finally {
      await subscription.unsubscribe();
    }
  }, 15_000);
});

/**
 * Writes `file` until the watcher publishes a change. On Windows a single
 * change has gone unheard by the native watcher under load, so one write is
 * not enough; a watcher that stopped hears none of them.
 */
async function writeUntilPublished(
  file: string,
  nextEvent: Promise<IteratorResult<unknown>>,
) {
  let heard: IteratorResult<unknown> | undefined;
  void nextEvent.then((event) => {
    heard = event;
  });
  return vi.waitFor(
    async () => {
      if (heard) {
        return heard;
      }
      await fs.writeFile(file, String(Date.now()));
      throw new Error(`No change heard yet for ${file}`);
    },
    { interval: 1000, timeout: 10_000 },
  );
}

async function setupWorkspace() {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "skill-watcher-"),
  );
  createMockChatConfigForDir(path.join(workspaceRoot, "tasks", "watcher-test"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(workspaceRoot),
  });
  await fs.mkdir(workspaceLayout(workspaceRoot).skillsDir, { recursive: true });
  return workspaceRoot;
}
