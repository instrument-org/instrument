import { type GetProviderConfigs } from "@instrument-org/ai-gateway";
import {
  type CaptureEventFunction,
  type CaptureExceptionFunction,
} from "@instrument-org/shared";

import { type APP_STATUSES } from "./constants";
import { type AbsolutePath, type WorkspaceDir } from "./schemas/paths";

export type AppStatus = (typeof APP_STATUSES)[number];

export interface WorkspaceConfig {
  captureEvent: CaptureEventFunction;
  captureException: CaptureExceptionFunction;
  getAIProviderConfigs: GetProviderConfigs;
  nodeExecEnv: Record<string, string>;
  pnpmBinPath: AbsolutePath;
  previewCacheTimeMs?: number;
  previewsDir: AbsolutePath;
  projectsDir: AbsolutePath;
  registryDir: AbsolutePath;
  rootDir: WorkspaceDir;
  templatesDir: AbsolutePath;
  trashItem: (path: AbsolutePath) => Promise<void>;
}
