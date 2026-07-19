import { type ImageModelV3, type LanguageModelV3 } from "@ai-sdk/provider";
import {
  type AIGatewayModel,
  AIGatewayProviderConfig,
  type AISDKImageModelResult,
  type AISDKWebSearchModelResult,
  type AISDKWebToolsResult,
  noopModelCache,
  TEST_IMAGE_MODEL_OVERRIDE_KEY,
  TEST_MODEL_OVERRIDE_KEY,
  TEST_WEB_SEARCH_MODEL_OVERRIDE_KEY,
  TEST_WEB_TOOLS_OVERRIDE_KEY,
} from "@instrument-org/ai-gateway";
import { AI_GATEWAY_API_KEY_NOT_NEEDED } from "@instrument-org/shared";
import path from "node:path";
import { noop } from "radashi";

import { PROJECTS_DIR_NAME, TASKS_DIR_NAME } from "../../constants";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import {
  type BrowserConfig,
  encodeBrowserTargetId,
  type WorkspaceConfig,
} from "../../types";
import { createMockAIGatewayModel } from "./mock-ai-gateway-model";

const MOCK_WORKSPACE_DIR = "/tmp/workspace";

export const MOCK_WORKSPACE_DIRS = {
  defaultTaskTemplate: `${MOCK_WORKSPACE_DIR}/default-task-template`,
  projects: `${MOCK_WORKSPACE_DIR}/${PROJECTS_DIR_NAME}`,
  registry: `${MOCK_WORKSPACE_DIR}/registry`,
  tasks: `${MOCK_WORKSPACE_DIR}/${TASKS_DIR_NAME}`,
} as const;

// Provider configs registered by createMockTaskConfig. The singleton's
// getAIProviderConfigs returns all of them so a test running two sessions with
// distinct models (distinct providerConfigIds) resolves each to its own model
// override. Configs are keyed by id so same-id mocks overwrite.
const mockProviderConfigs = new Map<
  string,
  ReturnType<typeof AIGatewayProviderConfig.Schema.parse>
>();

export function createMockTaskConfig(
  id: TaskId,
  options: {
    aiSDKModel?: LanguageModelV3;
    imageModel?: ImageModelV3;
    model?: AIGatewayModel.Type;
    webSearchModel?: AISDKWebSearchModelResult;
    webTools?: AISDKWebToolsResult;
  } = {},
) {
  const model = options.model ?? createMockAIGatewayModel();

  const config = AIGatewayProviderConfig.Schema.parse({
    apiKey: AI_GATEWAY_API_KEY_NOT_NEEDED,
    cacheIdentifier: "test-cache",
    id: model.params.providerConfigId,
    type: model.params.provider,
  });

  if (options.aiSDKModel) {
    (config as { [TEST_MODEL_OVERRIDE_KEY]?: LanguageModelV3 })[
      TEST_MODEL_OVERRIDE_KEY
    ] = options.aiSDKModel;
  }

  if (options.imageModel) {
    (
      config as {
        [TEST_IMAGE_MODEL_OVERRIDE_KEY]?: AISDKImageModelResult;
      }
    )[TEST_IMAGE_MODEL_OVERRIDE_KEY] = {
      model: options.imageModel,
      type: "image",
    };
  }

  if (options.webSearchModel) {
    (
      config as {
        [TEST_WEB_SEARCH_MODEL_OVERRIDE_KEY]?: AISDKWebSearchModelResult;
      }
    )[TEST_WEB_SEARCH_MODEL_OVERRIDE_KEY] = options.webSearchModel;
  }

  if (options.webTools) {
    (
      config as {
        [TEST_WEB_TOOLS_OVERRIDE_KEY]?: AISDKWebToolsResult;
      }
    )[TEST_WEB_TOOLS_OVERRIDE_KEY] = options.webTools;
  }

  const workspaceConfig: WorkspaceConfig = {
    appVersion: "0.0.0-test",
    browser: createStubBrowserConfig(),
    captureEvent: () => {
      // No-op
    },
    captureException: (...args: unknown[]) => {
      // eslint-disable-next-line no-console
      console.error("captureException", args);
    },
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      MOCK_WORKSPACE_DIRS.defaultTaskTemplate,
    ),
    getAIProviderConfigs: () => [...mockProviderConfigs.values()],
    modelCache: noopModelCache,
    nodeExecEnv: {},
    pnpmBinPath: AbsolutePathSchema.parse("/tmp/pnpm"),
    projectsDir: AbsolutePathSchema.parse(MOCK_WORKSPACE_DIRS.projects),
    registryDir: AbsolutePathSchema.parse(MOCK_WORKSPACE_DIRS.registry),
    rootDir: WorkspaceDirSchema.parse(MOCK_WORKSPACE_DIR),
    tasksDir: AbsolutePathSchema.parse(MOCK_WORKSPACE_DIRS.tasks),
    trashItem: () => Promise.resolve(),
    uvBinPath: AbsolutePathSchema.parse("/tmp/uv"),
    uvDataDir: AbsolutePathSchema.parse(`${MOCK_WORKSPACE_DIR}/uv-data`),
  };

  // Register this model's provider config and mirror production, where the
  // running workspace machine publishes its config as the process singleton
  // read by getWorkspaceConfig().
  mockProviderConfigs.set(config.id, config);
  setWorkspaceConfig(workspaceConfig);

  return id;
}

// Returns a task id whose taskDir(id) resolves to `dir`, by pointing the
// singleton's tasksDir at its parent. Replaces the old pattern of spreading
// a mock TaskId and overriding dir. The dir's basename must be a valid id.
export function createMockTaskConfigForDir(
  dir: string,
  options: Parameters<typeof createMockTaskConfig>[1] = {},
): TaskId {
  const id = TaskIdSchema.parse(path.basename(dir));
  createMockTaskConfig(id, options);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    tasksDir: AbsolutePathSchema.parse(path.dirname(dir)),
  });
  return id;
}

export function createStubBrowserConfig(): BrowserConfig {
  return {
    closeTarget: () => Promise.resolve(),
    createTarget: (id, sessionId) =>
      Promise.resolve({
        targetId: encodeBrowserTargetId(id, sessionId),
      }),
    getTargetMeta: () => null,
    listTargets: () => Promise.resolve([]),
    onTargetDestroyed: () => noop,
    sendCommand: () => Promise.resolve({}),
    stopScreencast: noop,
    subscribeEvents: () => noop,
  };
}
