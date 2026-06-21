import path from "node:path";

import {
  AbsolutePathSchema,
  WorkspaceDirSchema,
} from "../../src/schemas/paths";
import { createStubBrowserConfig } from "../../src/test/helpers/mock-app-config";
import { type WorkspaceConfig } from "../../src/types";

export function createStubWorkspaceConfig({
  projectsDir,
  rootDir = path.dirname(projectsDir),
}: {
  projectsDir: string;
  rootDir?: string;
}): WorkspaceConfig {
  const absoluteRootDir = path.resolve(rootDir);
  const absoluteProjectsDir = path.resolve(projectsDir);

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
    projectsDir: WorkspaceDirSchema.parse(absoluteProjectsDir),
    registryDir: WorkspaceDirSchema.parse(
      path.join(absoluteRootDir, "registry"),
    ),
    rootDir: WorkspaceDirSchema.parse(absoluteRootDir),
    templatesDir: WorkspaceDirSchema.parse(
      path.join(absoluteRootDir, "registry", "templates"),
    ),
    trashItem: () => Promise.resolve(),
  };
}
