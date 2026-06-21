import { type ImageModelV3, type LanguageModelV3 } from "@ai-sdk/provider";
import {
  type AIGatewayModel,
  AIGatewayProviderConfig,
  type AISDKImageModelResult,
  type AISDKWebSearchModelResult,
  TEST_IMAGE_MODEL_OVERRIDE_KEY,
  TEST_MODEL_OVERRIDE_KEY,
  TEST_WEB_SEARCH_MODEL_OVERRIDE_KEY,
} from "@instrument-org/ai-gateway";
import { AI_GATEWAY_API_KEY_NOT_NEEDED } from "@instrument-org/shared";
import { noop } from "radashi";

import { createAppConfig } from "../../lib/app-config/create";
import { setWorkspaceConfig } from "../../lib/workspace-config";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type AppSubdomain } from "../../schemas/subdomains";
import {
  type BrowserConfig,
  encodeBrowserTargetId,
  type WorkspaceConfig,
} from "../../types";
import { createMockAIGatewayModel } from "./mock-ai-gateway-model";

const MOCK_WORKSPACE_DIR = "/tmp/workspace";

export const MOCK_WORKSPACE_DIRS = {
  projects: `${MOCK_WORKSPACE_DIR}/projects`,
  registry: `${MOCK_WORKSPACE_DIR}/registry`,
  templates: `${MOCK_WORKSPACE_DIR}/registry/templates`,
} as const;

export function createMockAppConfig(
  subdomain: AppSubdomain,
  options: {
    aiSDKModel?: LanguageModelV3;
    imageModel?: ImageModelV3;
    model?: AIGatewayModel.Type;
    webSearchModel?: AISDKWebSearchModelResult;
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
    getAIProviderConfigs: () => [config],
    nodeExecEnv: {},
    pnpmBinPath: AbsolutePathSchema.parse("/tmp/pnpm"),
    projectsDir: AbsolutePathSchema.parse(MOCK_WORKSPACE_DIRS.projects),
    registryDir: AbsolutePathSchema.parse(MOCK_WORKSPACE_DIRS.registry),
    rootDir: WorkspaceDirSchema.parse(MOCK_WORKSPACE_DIR),
    templatesDir: AbsolutePathSchema.parse(MOCK_WORKSPACE_DIRS.templates),
    trashItem: () => Promise.resolve(),
  };

  // Mirror production, where the running workspace machine publishes its config
  // as the process singleton read by getWorkspaceConfig().
  setWorkspaceConfig(workspaceConfig);

  return createAppConfig({ subdomain, workspaceConfig });
}

export function createStubBrowserConfig(): BrowserConfig {
  return {
    captureScreenshot: () => Promise.resolve(undefined),
    closeTarget: () => Promise.resolve(),
    createTarget: (subdomain, sessionId) =>
      Promise.resolve({
        targetId: encodeBrowserTargetId(subdomain, sessionId),
      }),
    getTargetMeta: () => null,
    listTargets: () => Promise.resolve([]),
    onTargetDestroyed: () => noop,
    sendCommand: () => Promise.resolve({}),
    stopScreencast: noop,
    subscribeEvents: () => noop,
  };
}
