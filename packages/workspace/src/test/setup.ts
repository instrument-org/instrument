// The package root re-exports the gateway's Hono app and every model-fetching
// path with it, which is around a second of module evaluation per test file --
// paid once for each of them, since every file gets its own module registry.
// This subpath is a leaf, so the setup every test file loads stays cheap.
import { noopModelCache } from "@instrument-org/ai-gateway/model-cache";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

import { createMemoryAppsConfig } from "../lib/apps/memory-config";
import {
  ChatRecords,
  installChatRecords,
  writingChatRecords,
} from "../lib/records/chat-records";
import { chatDir } from "../lib/record-folders";
import { setWorkspaceConfig } from "../lib/workspace-config";
import { workspaceLayout } from "../lib/workspace-layout";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { unavailableWebSearchClient } from "../schemas/web-search";
import { newDeviceId } from "../lib/records/device-id";

const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "instrument-workspace-test-"),
);
const tasksDir = path.join(rootDir, "tasks");
const layout = workspaceLayout(rootDir);
// Outside the workspace, as this computer's folder for it is.
const machineDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "instrument-workspace-machine-test-"),
);
const noop = () => {
  return;
};
const noopCleanup = () => {
  return noop;
};
const rejectBrowserTarget = () => {
  return Promise.reject(new Error("browser not available in test setup"));
};

// Install a workspace config for every test, the way the workspace machine does
// at boot in production. Without it, code that reads getWorkspaceConfig() would
// need an "if initialized" escape hatch just to survive tests. Tests that need
// specific paths override it (createMockChatConfig). Keep this setup free of
// runtime imports from `../types`, which would preload `store-id` before
// `vi.mock(import("ulid"))` runs in snapshot tests.
setWorkspaceConfig({
  apps: createMemoryAppsConfig(),
  appsDir: AbsolutePathSchema.parse(layout.appsDir),
  appVersion: "0.0.0-test",
  browser: {
    closeTarget: () => Promise.resolve(),
    hasNoWindow: false,
    isGuestBusy: () => false,
    createTarget: rejectBrowserTarget,
    contentBlocking: () => ({ task: true, workspace: true }),
    getTargetMeta: () => null,
    getTargetUrl: (): string | undefined => {
      // No guest is ever live here, so there is no address to report.
      return;
    },
    listTargets: () => Promise.resolve([]),
    onTargetDestroyed: noopCleanup,
    sendCommand: () => Promise.resolve({}),
    setAgentFileRoots: noop,
    stopScreencast: noop,
    subscribeEvents: noopCleanup,
  },
  captureException: noop,
  deviceId: newDeviceId(),
  getAIProviderConfigs: () => [],
  modelCache: noopModelCache,
  nodeExecEnv: {},
  pnpmBinPath: AbsolutePathSchema.parse("/usr/bin/pnpm"),
  registryDir: AbsolutePathSchema.parse(path.join(rootDir, "registry")),
  rootDir: WorkspaceDirSchema.parse(rootDir),
  runtimeDir: AbsolutePathSchema.parse(path.join(rootDir, "runtime")),
  systemSkillsDir: AbsolutePathSchema.parse(
    path.join(rootDir, "system-skills"),
  ),
  chatsDir: AbsolutePathSchema.parse(layout.chatsDir),
  legacyTasksDir: WorkspaceDirSchema.parse(tasksDir),
  tempFolders: [],
  trashItem: () => Promise.resolve(),
  uvBinPath: AbsolutePathSchema.parse("/usr/bin/uv"),
  webSearch: unavailableWebSearchClient,
  workFoldersDir: AbsolutePathSchema.parse(path.join(machineDir, "work")),
  machineDir: AbsolutePathSchema.parse(machineDir),
  workspaceMachineDir: AbsolutePathSchema.parse(machineDir),
});

// A chat is written through its records, so every test has them, in its own
// temporary chats folder, the way the workspace puts them in place as it
// opens. `chatDir` is read per write, so a test that points the config at
// another folder is followed there. Nothing is synced: nothing here has to
// survive a power cut.
installChatRecords(
  new ChatRecords({
    app: "0.0.0-test",
    device: newDeviceId(),
    dirOf: chatDir,
    fsync: false,
  }),
);

afterAll(async () => {
  const records = writingChatRecords();
  installChatRecords(undefined);
  await records?.dispose();
});

// Shells run on the test's own thread, where `vi.mock` reaches them, unless
// INSTRUMENT_BASH_WORKER=1 asks for every one to run in the bash worker.
// Imported only then: loading the worker client here would load modules a
// test file mocks (`ulid` among them) before its mock is in place.
if (process.env.INSTRUMENT_BASH_WORKER === "1") {
  const [{ setBashWorkerFactory }, { createTsxBashWorker }] = await Promise.all(
    [import("../lib/bash-worker/client"), import("./helpers/tsx-bash-worker")],
  );
  setBashWorkerFactory(createTsxBashWorker);
}
