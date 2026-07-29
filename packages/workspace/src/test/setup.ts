import { noopModelCache } from "@instrument-org/ai-gateway";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { setWorkspaceConfig } from "../lib/workspace-config";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { unavailableWebSearchClient } from "../schemas/web-search";

const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "instrument-workspace-test-"),
);
const tasksDir = path.join(rootDir, "tasks");
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
// specific paths override it (createMockTaskConfig). Keep this setup free of
// runtime imports from `../types`, which would preload `store-id` before
// `vi.mock(import("ulid"))` runs in snapshot tests.
setWorkspaceConfig({
  appVersion: "0.0.0-test",
  browser: {
    closeTarget: () => Promise.resolve(),
    createTarget: rejectBrowserTarget,
    getTargetMeta: () => null,
    listTargets: () => Promise.resolve([]),
    onTargetDestroyed: noopCleanup,
    sendCommand: () => Promise.resolve({}),
    stopScreencast: noop,
    subscribeEvents: noopCleanup,
  },
  captureEvent: noop,
  captureException: noop,
  connectors: { getCredential: () => Promise.resolve(null) },
  connectorsDir: AbsolutePathSchema.parse(path.join(rootDir, "connectors")),
  defaultTaskTemplateDir: AbsolutePathSchema.parse(
    path.join(rootDir, "default-task-template"),
  ),
  getAIProviderConfigs: () => [],
  isExternalBrowserEnabled: () => false,
  modelCache: noopModelCache,
  nodeExecEnv: {},
  pnpmBinPath: AbsolutePathSchema.parse("/usr/bin/pnpm"),
  projectsDir: AbsolutePathSchema.parse(path.join(rootDir, "projects")),
  registryDir: AbsolutePathSchema.parse(path.join(rootDir, "registry")),
  rootDir: WorkspaceDirSchema.parse(rootDir),
  systemSkillsDir: AbsolutePathSchema.parse(
    path.join(rootDir, "system-skills"),
  ),
  tasksDir: WorkspaceDirSchema.parse(tasksDir),
  trashItem: () => Promise.resolve(),
  uvBinPath: AbsolutePathSchema.parse("/usr/bin/uv"),
  uvDataDir: AbsolutePathSchema.parse(path.join(rootDir, "uv-data")),
  webSearch: unavailableWebSearchClient,
});
