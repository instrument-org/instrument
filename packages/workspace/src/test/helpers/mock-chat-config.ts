import { type ImageModelV4, type LanguageModelV4 } from "@ai-sdk/provider";
import {
  type AISDKImageModelResult,
  type AISDKWebSearchModelResult,
} from "@instrument-org/ai-gateway";
import { noopModelCache } from "@instrument-org/ai-gateway/model-cache";
// The values come from the subpaths rather than the package root, which every
// test file using this helper would otherwise pay a second of module
// evaluation for. See the comment on the gateway's `schemas` barrel.
import {
  type AIGatewayModel,
  AIGatewayProviderConfig,
  TEST_IMAGE_MODEL_OVERRIDE_KEY,
  TEST_MODEL_OVERRIDE_KEY,
  TEST_WEB_SEARCH_MODEL_OVERRIDE_KEY,
} from "@instrument-org/ai-gateway/schemas";
import {
  AI_GATEWAY_API_KEY_NOT_NEEDED,
  WORKSPACE_MACHINE_ENTRIES,
} from "@instrument-org/shared";
import { createHash } from "node:crypto";
import path from "node:path";
import { noop } from "radashi";

import { CHATS_DIR_NAME, TASKS_DIR_NAME } from "../../constants";
import { createMemoryAppsConfig } from "../../lib/apps/memory-config";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import {
  unavailableWebSearchClient,
  type WebSearchClient,
} from "../../schemas/web-search";
import { type BrowserConfig, type WorkspaceConfig } from "../../types";
import { createMockAIGatewayModel } from "./mock-ai-gateway-model";
import { forgetChat, placeChat } from "../../lib/record-folders";
import { StoreId } from "../../schemas/store-id";

const MOCK_WORKSPACE_DIR = "/tmp/workspace";
// Outside the workspace, as this computer's folder for it is.
const MOCK_WORKSPACE_MACHINE_DIR = "/tmp/workspace-machine";

export const MOCK_WORKSPACE_DIRS = {
  registry: `${MOCK_WORKSPACE_DIR}/registry`,
  systemSkills: `${MOCK_WORKSPACE_DIR}/system-skills`,
  chats: `${MOCK_WORKSPACE_DIR}/${CHATS_DIR_NAME}`,
  machine: MOCK_WORKSPACE_MACHINE_DIR,
  tasks: `${MOCK_WORKSPACE_DIR}/${TASKS_DIR_NAME}`,
  work: `${MOCK_WORKSPACE_MACHINE_DIR}/${WORKSPACE_MACHINE_ENTRIES.work}`,
} as const;

// Provider configs registered by createMockChatConfig. The singleton's
// getAIProviderConfigs returns all of them so a test running two sessions with
// distinct models (distinct providerConfigIds) resolves each to its own model
// override. Configs are keyed by id so same-id mocks overwrite.
const mockProviderConfigs = new Map<
  string,
  ReturnType<typeof AIGatewayProviderConfig.Schema.parse>
>();

export function createMockChatConfig(
  id: ChatId,
  options: {
    aiSDKModel?: LanguageModelV4;
    /**
     * Models this config's provider knows about, for the paths that resolve an
     * id the app did not ask for. Empty by default, which is the cold-cache
     * outcome those paths all have to survive anyway.
     */
    catalog?: AIGatewayModel.Type[];
    imageModel?: ImageModelV4;
    model?: AIGatewayModel.Type;
    /**
     * Leaves the id out of the folder index, for a test that makes the chat
     * itself through `initializeChat`, which places it.
     */
    unplaced?: boolean;
    webSearch?: WebSearchClient;
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
    (config as { [TEST_MODEL_OVERRIDE_KEY]?: LanguageModelV4 })[
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
    apps: createMemoryAppsConfig(),
    appsDir: AbsolutePathSchema.parse([MOCK_WORKSPACE_DIR, "apps"].join("/")),
    appVersion: "0.0.0-test",
    browser: createStubBrowserConfig(),
    captureException: (...args: unknown[]) => {
      console.error("captureException", args);
    },
    getAIProviderConfigs: () => [...mockProviderConfigs.values()],
    modelCache: options.catalog
      ? { ...noopModelCache, read: () => options.catalog }
      : noopModelCache,
    nodeExecEnv: {},
    pnpmBinPath: AbsolutePathSchema.parse("/tmp/pnpm"),
    registryDir: AbsolutePathSchema.parse(MOCK_WORKSPACE_DIRS.registry),
    chatsDir: AbsolutePathSchema.parse(MOCK_WORKSPACE_DIRS.chats),
    rootDir: WorkspaceDirSchema.parse(MOCK_WORKSPACE_DIR),
    runtimeDir: AbsolutePathSchema.parse(`${MOCK_WORKSPACE_DIR}/runtime`),
    systemSkillsDir: AbsolutePathSchema.parse(MOCK_WORKSPACE_DIRS.systemSkills),
    legacyTasksDir: AbsolutePathSchema.parse(MOCK_WORKSPACE_DIRS.chats),
    tempFolders: [],
    trashItem: () => Promise.resolve(),
    uvBinPath: AbsolutePathSchema.parse("/tmp/uv"),
    webSearch: options.webSearch ?? unavailableWebSearchClient,
    workFoldersDir: AbsolutePathSchema.parse(MOCK_WORKSPACE_DIRS.work),
    machineDir: AbsolutePathSchema.parse(MOCK_WORKSPACE_DIRS.machine),
    workspaceMachineDir: AbsolutePathSchema.parse(MOCK_WORKSPACE_DIRS.machine),
  };

  // Register this model's provider config and mirror production, where the
  // running workspace machine publishes its config as the process singleton
  // read by getWorkspaceConfig().
  mockProviderConfigs.set(config.id, config);
  setWorkspaceConfig(workspaceConfig);
  if (!options.unplaced) {
    knowChat(id);
  }

  return id;
}

/**
 * Puts a chat in the folder index at the config's `chatsDir`, so `chatDir`
 * answers for it before the test makes its folder, or without one. Its own
 * conversation is a session named after the chat rather than a fresh one,
 * so placing it mints no id a snapshot counts, and whatever a folder of the
 * same name on disk says is set aside.
 */
export function knowChat(id: ChatId) {
  forgetChat(id);
  placeChat(id, mockSessionOf(id));
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A session id made from a chat id, the same one every time. */
function mockSessionOf(id: ChatId): StoreId.Session {
  const digest = createHash("sha256").update(id).digest();
  const chars = [...digest.subarray(0, 25)].map((byte) => CROCKFORD[byte % 32]);
  return StoreId.SessionSchema.parse(`ses_0${chars.join("")}`);
}

// Returns a chat id whose record folder (chatDir) and work folder (workDir)
// both resolve to `dir`, by pointing the singleton's chatsDir and
// workFoldersDir at its parent. The dir's basename must be a valid id. A test
// of what lies apart between the two sets them apart itself.
export function createMockChatConfigForDir(
  dir: string,
  options: Parameters<typeof createMockChatConfig>[1] = {},
): ChatId {
  const id = ChatIdSchema.parse(path.basename(dir));
  createMockChatConfig(id, { ...options, unplaced: true });
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.dirname(dir)),
    workFoldersDir: AbsolutePathSchema.parse(path.dirname(dir)),
  });
  if (!options.unplaced) {
    knowChat(id);
  }
  return id;
}

export function createStubBrowserConfig(): BrowserConfig {
  return {
    closeTarget: () => Promise.resolve(),
    createTarget: () => Promise.resolve(),
    contentBlocking: () => ({ task: true, workspace: true }),
    getTargetMeta: () => null,
    hasNoWindow: false,
    isGuestBusy: () => false,
    getTargetUrl: (): string | undefined => {
      // No guest is ever live here, so there is no address to report.
      return;
    },
    listTargets: () => Promise.resolve([]),
    onTargetDestroyed: () => noop,
    sendCommand: () => Promise.resolve({}),
    setAgentFileRoots: noop,
    stopScreencast: noop,
    subscribeEvents: () => noop,
  };
}
