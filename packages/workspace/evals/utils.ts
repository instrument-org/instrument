import {
  AIGatewayModelURI,
  type AIGatewayProviderConfig,
  noopModelCache,
} from "@instrument-org/ai-gateway";
import {
  AIProviderConfigIdSchema,
  APP_NAME_SLUG,
} from "@instrument-org/shared";
import path from "node:path";
import { z } from "zod";

import { env } from "../scripts/lib/env";
import { PROJECTS_DIR_NAME, TASKS_DIR_NAME } from "../src/constants";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../src/schemas/paths";
import { unavailableWebSearchClient } from "../src/schemas/web-search";
import { createStubBrowserConfig } from "../src/test/helpers/mock-task-config";
import { type WorkspaceConfig } from "../src/types";

export const c = {
  cyan: "\u001B[36m",
  dim: "\u001B[2m",
  green: "\u001B[32m",
  red: "\u001B[31m",
  reset: "\u001B[0m",
  yellow: "\u001B[33m",
};

export function buildReportWorkspaceConfig(
  absoluteWorkspaceDir: string,
): WorkspaceConfig {
  return {
    appVersion: "0.0.0-test",
    browser: createStubBrowserConfig(),
    captureEvent: () => {
      return;
    },
    captureException: () => {
      return;
    },
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.join(absoluteWorkspaceDir, "default-task-template"),
    ),
    getAIProviderConfigs: () => [],
    isExternalBrowserEnabled: () => true,
    modelCache: noopModelCache,
    nodeExecEnv: {},
    pnpmBinPath: AbsolutePathSchema.parse("/usr/bin/pnpm"),
    projectsDir: AbsolutePathSchema.parse(
      path.join(absoluteWorkspaceDir, PROJECTS_DIR_NAME),
    ),
    registryDir: WorkspaceDirSchema.parse(resolveRegistryDir()),
    rootDir: WorkspaceDirSchema.parse(absoluteWorkspaceDir),
    systemSkillsDir: AbsolutePathSchema.parse(
      path.join(absoluteWorkspaceDir, "system-skills"),
    ),
    tasksDir: WorkspaceDirSchema.parse(
      path.join(absoluteWorkspaceDir, TASKS_DIR_NAME),
    ),
    trashItem: () => Promise.resolve(),
    uvBinPath: AbsolutePathSchema.parse("/usr/bin/uv"),
    uvDataDir: AbsolutePathSchema.parse(
      path.join(absoluteWorkspaceDir, "uv-data"),
    ),
    webSearch: unavailableWebSearchClient,
  };
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return num.toString();
}

export function resolveRegistryDir(): string {
  return env.APP_REGISTRY_DIR_PATH
    ? path.resolve(env.APP_REGISTRY_DIR_PATH)
    : path.resolve(import.meta.dirname, "../../../registry");
}

const PROVIDER_MAP: {
  envKey: keyof typeof env;
  type: AIGatewayProviderConfig.Type["type"];
}[] = [
  { envKey: "APP_OPENAI_API_KEY", type: "openai" },
  { envKey: "APP_OPENROUTER_API_KEY", type: "openrouter" },
  { envKey: "APP_ANTHROPIC_API_KEY", type: "anthropic" },
  { envKey: "APP_GOOGLE_API_KEY", type: "google" },
  { envKey: "APP_AI_GATEWAY_API_KEY", type: "vercel" },
  { envKey: "APP_ZAI_API_KEY", type: "z-ai" },
  { envKey: "APP_CEREBRAS_API_KEY", type: "cerebras" },
  { envKey: "APP_GROQ_API_KEY", type: "groq" },
];

function providerConfigId(type: AIGatewayProviderConfig.Type["type"]): string {
  return `${type}-config-id`;
}

export const modelURI = {
  openRouter: (model: string) =>
    AIGatewayModelURI.Schema.parse(
      `${model}?provider=openrouter&providerConfigId=${providerConfigId("openrouter")}`,
    ),
};

const OpenRouterAliasListSchema = z.object({
  data: z.array(
    z.object({
      alias_target: z.object({ slug: z.string() }).nullish(),
      id: z.string(),
    }),
  ),
});

export function buildProviderConfigs(): AIGatewayProviderConfig.Type[] {
  const cacheIdentifier = `${APP_NAME_SLUG}-evals`;
  const configs: AIGatewayProviderConfig.Type[] = [
    // Uncomment to test with Ollama
    // {
    //   apiKey: "ollama",
    //   cacheIdentifier,
    //   id: providerConfigId("ollama"),
    //   type: "ollama",
    // },
  ];

  for (const { envKey, type } of PROVIDER_MAP) {
    const apiKey = env[envKey];
    if (apiKey) {
      configs.push({
        apiKey,
        cacheIdentifier,
        id: AIProviderConfigIdSchema.parse(providerConfigId(type)),
        type,
      });
    }
  }

  return configs;
}

/**
 * OpenRouter's moving aliases (`~anthropic/claude-sonnet-latest`) are what keep
 * the eval model set current without anyone editing it, and they are also why a
 * result on its own no longer says what it was produced against. Its public
 * model list carries the target of each alias, so the answer costs one
 * unauthenticated GET and never has to reach the provider being tested.
 *
 * Returns an empty map on any failure: knowing which build answered is worth
 * printing, never worth failing a run over.
 */
export async function resolveOpenRouterAliases(
  modelURIs: string[],
): Promise<Map<string, string>> {
  const aliases = modelURIs
    .map((uri) => uri.split("?")[0] ?? uri)
    .filter((slug) => slug.startsWith("~"));
  if (aliases.length === 0) {
    return new Map();
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models");
    const body: unknown = await response.json();
    const parsed = OpenRouterAliasListSchema.parse(body);
    const targets = new Map(
      parsed.data.flatMap((model) =>
        model.alias_target ? [[model.id, model.alias_target.slug]] : [],
      ),
    );
    return new Map(
      aliases.flatMap((slug) => {
        const target = targets.get(slug);
        return target ? [[slug, target] as const] : [];
      }),
    );
  } catch {
    return new Map();
  }
}
