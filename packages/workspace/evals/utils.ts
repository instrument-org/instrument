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

/**
 * Color is off unless a terminal is going to read it. Every consumer of this
 * output so far has been a pipe -- a run filtered through `rg`, a log file
 * parsed afterwards -- and an escape sequence inside a line the reader is
 * matching on is a filter that silently returns nothing.
 */
const useColor =
  env.FORCE_COLOR !== undefined ||
  (env.NO_COLOR === undefined && process.stdout.isTTY);

const color = (code: string) => (useColor ? code : "");

export const c = {
  cyan: color("[36m"),
  dim: color("[2m"),
  green: color("[32m"),
  red: color("[31m"),
  reset: color("[0m"),
  yellow: color("[33m"),
};

let humanStream: NodeJS.WritableStream = process.stdout;

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

/**
 * Approximate, and marked as such wherever it is printed: the token counts it
 * multiplies do not separate a cached read from a fresh one, and only
 * OpenRouter models have a price here at all. It is the difference between
 * knowing a suite cost roughly ten dollars and knowing only that it produced
 * four million tokens.
 */
export function formatCost(usd: number): string {
  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
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

export function setHumanOutputStream(stream: NodeJS.WritableStream): void {
  humanStream = stream;
}

/**
 * Everything written for a person to read. `--json` moves it to stderr so that
 * stdout carries the report and nothing else, which is what lets a caller pipe
 * a run straight into a parser.
 */
export function write(text: string): void {
  humanStream.write(text);
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

/** Per-token USD, as OpenRouter states it. */
interface ModelPrice {
  completion: number;
  prompt: number;
}

export interface OpenRouterCatalog {
  /** Moving alias slug -> the build it stood for at run time. */
  aliasTargets: Map<string, string>;
  priceFor: (slug: string) => ModelPrice | undefined;
}

const NumericStringSchema = z
  .string()
  .transform((value) => Number.parseFloat(value))
  .pipe(z.number().finite());

const OpenRouterModelListSchema = z.object({
  data: z.array(
    z.object({
      alias_target: z.object({ slug: z.string() }).nullish(),
      id: z.string(),
      pricing: z
        .object({
          completion: NumericStringSchema,
          prompt: NumericStringSchema,
        })
        .nullish(),
    }),
  ),
});

const NO_PRICES = new Map<string, ModelPrice>();

const emptyOpenRouterCatalog: OpenRouterCatalog = {
  aliasTargets: new Map(),
  priceFor: (slug) => NO_PRICES.get(slug),
};

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
 * One unauthenticated GET answers two questions a run cannot answer for itself.
 *
 * OpenRouter's moving aliases (`~anthropic/claude-sonnet-latest`) are what keep
 * the eval model set current without anyone editing it, and they are also why a
 * result on its own no longer says what it was produced against. The same
 * response carries per-token prices, which is the only place a token count can
 * be turned into the number anyone actually budgets in.
 *
 * Degrades to an empty catalog on any failure: knowing which build answered and
 * what it cost is worth printing, never worth failing a run over.
 */
export async function fetchOpenRouterCatalog(
  modelURIs: string[],
): Promise<OpenRouterCatalog> {
  const slugs = modelURIs.map((uri) => uri.split("?")[0] ?? uri);
  if (slugs.length === 0) {
    return emptyOpenRouterCatalog;
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models");
    const body: unknown = await response.json();
    const parsed = OpenRouterModelListSchema.parse(body);

    const targets = new Map(
      parsed.data.flatMap((model) =>
        model.alias_target ? [[model.id, model.alias_target.slug]] : [],
      ),
    );
    const prices = new Map(
      parsed.data.flatMap((model) =>
        model.pricing ? [[model.id, model.pricing]] : [],
      ),
    );

    return {
      aliasTargets: new Map(
        slugs.flatMap((slug) => {
          const target = targets.get(slug);
          return target && slug.startsWith("~")
            ? [[slug, target] as const]
            : [];
        }),
      ),
      // An alias carries its own pricing, so the fallback is only reached for a
      // slug the list does not know at all.
      priceFor: (slug) =>
        prices.get(slug) ?? prices.get(targets.get(slug) ?? ""),
    };
  } catch {
    return emptyOpenRouterCatalog;
  }
}
