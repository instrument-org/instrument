// The package root re-exports the gateway's Hono app and every model-fetching
// path with it, which is around a second of module evaluation per test file --
// paid once for each of them, since every file gets its own module registry.
// This subpath is a leaf, so the setup every test file loads stays cheap.
import { noopModelCache } from "@instrument-org/ai-gateway/model-cache";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";

import { createMemoryAppsConfig } from "../lib/apps/memory-config";
import { readChatIndexOnFirstUse } from "../lib/chat-index-first-use";
import {
  mxcTestConfig,
  mxcTestDataDir,
  mxcTestWorkFoldersDir,
} from "./helpers/mxc-test-config";
import { MOCK_WORKSPACE_ROOT } from "./helpers/mock-workspace-root";
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
// Each test points the config at chats folders of its own, which no launch
// has read the chat index of.
readChatIndexOnFirstUse();
setWorkspaceConfig({
  apps: createMemoryAppsConfig(),
  appsDir: AbsolutePathSchema.parse(layout.appsDir),
  appVersion: "0.0.0-test",
  browser: {
    closeTarget: () => Promise.resolve(),
    hasNoWindow: false,
    guestCost: () => null,
    isGuestAsleep: () => false,
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
    sleepGuest: noop,
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
  userDataDir: AbsolutePathSchema.parse(machineDir),
  workspaceMachineDir: AbsolutePathSchema.parse(machineDir),
  ...mxcTestConfig(),
});

// A chat is written through its records, so every test has them, in its own
// temporary chats folder, the way the workspace puts them in place as it
// opens. `chatDir` is read per write, so a test that points the config at
// another folder is followed there. Nothing is synced: nothing here has to
// survive a power cut.
// Imported in a hook rather than at the top of this file: the records reach
// `store-id` for the ids they read, and anything this setup imports is loaded
// before a test file's `vi.mock(import("ulid"))` is registered, which would
// leave every snapshot of an id unmocked.
let testRecords: import("../lib/records/chat-records").ChatRecords | undefined;

beforeAll(async () => {
  const [{ ChatRecords, installChatRecords }, { chatDir }] = await Promise.all([
    import("../lib/records/chat-records"),
    import("../lib/record-folders"),
  ]);
  testRecords = new ChatRecords({
    app: "0.0.0-test",
    device: newDeviceId(),
    dirOf: chatDir,
    fsync: false,
  });
  installChatRecords(testRecords);
});

afterAll(async () => {
  const { installChatRecords } = await import("../lib/records/chat-records");
  installChatRecords(undefined);
  await testRecords?.dispose();
  testRecords = undefined;
  // The folders this file made, which are a test file's each: left
  // behind, a run of the suite adds a few hundred to the machine's temporary
  // folder, and enough runs fill it to the point where nothing on the
  // machine can make another one.
  for (const dir of [
    rootDir,
    machineDir,
    MOCK_WORKSPACE_ROOT,
    mxcTestDataDir(),
    mxcTestWorkFoldersDir(),
  ]) {
    if (dir === undefined) {
      continue;
    }
    fs.rmSync(dir, { force: true, recursive: true });
  }
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
