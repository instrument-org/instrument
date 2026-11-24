import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type LiveEvent } from "../rpc/publisher";
import { WorkspaceDirSchema } from "../schemas/paths";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { closeAppStores } from "./apps/store";
import { setWorkspaceInFront } from "./in-front";
import { changesTo } from "./live-changes";
import { memoryDir } from "./memory/store";
import { DEVICE_B } from "./records/test-records";
import { SYNCED_DOMAINS, type SyncedDomain } from "./synced-store/domains";
import { applySyncedOps } from "./synced-store/synced-files";
import * as devices from "./synced-store/watch-devices";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { workspaceLayout } from "./workspace-layout";

let root: string;
let controller: AbortController;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "live-changes-"));
  createMockChatConfigForDir(path.join(root, "tasks", "live-changes"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(root),
  });
  controller = new AbortController();
});

afterEach(async () => {
  controller.abort();
  setWorkspaceInFront(false);
  vi.restoreAllMocks();
  await closeAppStores();
  await fs.rm(root, { force: true, recursive: true });
});

function heardOf(event: LiveEvent) {
  const heard = vi.fn();
  const changes = changesTo(event, controller.signal);
  void (async () => {
    for await (const _ of changes) {
      heard();
    }
  })().catch(() => undefined);
  return heard;
}

/**
 * Makes a change again until one is heard: one made while a store is still
 * opening is part of its first read, which a live route reads from anyway.
 */
async function untilHeard(heard: () => void, change: () => void) {
  await vi.waitFor(
    () => {
      change();
      expect(heard).toHaveBeenCalled();
    },
    { interval: 600, timeout: 10_000 },
  );
}

function writeAsAnotherDevice(domain: SyncedDomain) {
  applySyncedOps({
    device: DEVICE_B,
    devicesDir: workspaceLayout(root).devicesDir,
    domain,
    ops: [{ key: crypto.randomUUID(), t: "set", value: {} }],
  });
}

const shown = Object.entries(SYNCED_DOMAINS).flatMap(([domain, how]) =>
  "event" in how
    ? // Object.entries widens the keys of a const object to string.
      [{ domain: domain as SyncedDomain, event: how.event }]
    : [],
);

describe("every synced store shown through an event", () => {
  it.each(shown)(
    "says $event when another device changes $domain",
    async ({ domain, event }) => {
      const heard = heardOf(event);
      await untilHeard(heard, () => writeAsAnotherDevice(domain));
      expect(heard).toHaveBeenCalled();
    },
    15_000,
  );

  it.each(shown)(
    "says $event for a change to $domain the watch missed, once a window comes forward",
    async ({ domain, event }) => {
      vi.spyOn(devices, "watchDevices").mockReturnValue(() => undefined);
      const heard = heardOf(event);
      await untilHeard(heard, () => {
        writeAsAnotherDevice(domain);
        setWorkspaceInFront(true);
      });
      expect(heard).toHaveBeenCalled();
    },
    15_000,
  );
});

it("names every store so no file reads as another's conflict copy", () => {
  for (const domain of Object.keys(SYNCED_DOMAINS)) {
    expect(domain).toMatch(/^[a-z][a-z0-9]*$/);
  }
});

it("watches once however many listen, until the last stops", () => {
  const stop = vi.fn();
  const watch = vi.spyOn(devices, "watchDevices").mockReturnValue(stop);
  const first = new AbortController();
  const second = new AbortController();
  changesTo("project.changed", first.signal);
  changesTo("project.changed", second.signal);
  expect(watch).toHaveBeenCalledTimes(1);
  first.abort();
  expect(stop).not.toHaveBeenCalled();
  second.abort();
  expect(stop).toHaveBeenCalledTimes(1);
});

it("waits for a missing memory folder without making it, then says so", async () => {
  const heard = heardOf("memory.changed");
  await expect(fs.stat(memoryDir())).rejects.toThrow();
  await fs.mkdir(memoryDir());
  // The folder can go unreported by its parent's watcher, and is then found
  // by the look each second, which a loaded machine can stretch.
  await vi.waitFor(() => expect(heard).toHaveBeenCalled(), {
    interval: 100,
    timeout: 10_000,
  });
}, 15_000);
