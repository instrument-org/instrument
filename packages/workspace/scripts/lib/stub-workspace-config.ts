import path from "node:path";

import {
  AbsolutePathSchema,
  WorkspaceDirSchema,
} from "../../src/schemas/paths";
import {
  createStubBrowserConfig,
} from "../../src/test/helpers/mock-app-config";
import {
  type WorkspaceConfig,
} from "../../src/types";

export function createStubWorkspaceConfig({
  tasksDir,
  rootDir = path.dirname(tasksDir),
}: {
  rootDir?: string;
  tasksDir: string;
}): WorkspaceConfig {
  const absoluteRootDir = path.resolve(rootDir);
  const absoluteProjectsDir = path.resolve(tasksDir);

  return {
    appVersion: "0.0.0-test",
    browser: createStubBrowserConfig(),
    captureEvent: () => {
      return;
    },
    captureException: () => {
      return;
    },
    getAIProviderConfigs: () => [],
    nodeExecEnv: {},
    pnpmBinPath: AbsolutePathSchema.parse("/usr/bin/pnpm"),
    registryDir: WorkspaceDirSchema.parse(
      path.join(absoluteRootDir, "registry"),
    ),
    rootDir: WorkspaceDirSchema.parse(absoluteRootDir),
    tasksDir: WorkspaceDirSchema.parse(absoluteProjectsDir),
    templatesDir: WorkspaceDirSchema.parse(
      path.join(absoluteRootDir, "registry", "templates"),
    ),
    trashItem: () => Promise.resolve(),
  };
}
