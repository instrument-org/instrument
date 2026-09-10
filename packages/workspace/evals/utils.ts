import {
  type AIGatewayModel,
  AIGatewayModelURI,
  type AIGatewayProviderConfig,
  fetchModelResultsForProviders,
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
import { createMemoryAppsConfig } from "../src/lib/apps/memory-config";
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
    apps: createMemoryAppsConfig(),
    appsDir: AbsolutePathSchema.parse(path.join(absoluteWorkspaceDir, "apps")),
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
    preparedSkillsDir: AbsolutePathSchema.parse(
      path.join(absoluteWorkspaceDir, "prepared-skills"),
    ),
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

/**
 * Every model the configured providers can actually run, newest first.
 *
 * Asked live rather than kept in a list here, because the point of the listing
 * is to be current: a model this project would want to test against today is
 * one that shipped after whatever a constant in this repo was last edited. A
 * restricted model is one this account cannot run, so it is left out rather
 * than offered to a run that would fail on its first request.
 */
export async function listConfiguredModels(
  pattern?: string,
): Promise<AIGatewayModel.Type[]> {
  const results = await fetchModelResultsForProviders(buildProviderConfigs(), {
    captureException: () => {
      return;
    },
    modelCache: noopModelCache,
  });
  const needle = pattern?.toLowerCase();
  return results
    .flatMap((result) => (result.ok ? result.value : []))
    .filter((model) => model.restricted === undefined)
    .filter(
      (model) =>
        !needle || `${model.uri} ${model.name}`.toLowerCase().includes(needle),
    )
    .toSorted(
      (a, b) =>
        (b.releasedAt ?? "").localeCompare(a.releasedAt ?? "") ||
        a.name.localeCompare(b.name),
    );
}

/**
 * Workers AI is an `openai-compatible` provider whose base URL names the
 * Cloudflare account: that is the type whose model listing knows the
 * models/search API, and the base URL is what the gateway matches on to apply
 * the stream repair. Its own config id keeps it apart from any other
 * OpenAI-compatible endpoint configured at the same time.
 */
const WORKERS_AI_CONFIG_ID = "workers-ai-config-id";

/**
 * How this model is spelled on the command line: the string that goes after
 * `--model`, ready to copy. A listing whose ids have to be translated before
 * they can be run is a listing nobody uses.
 */
export function modelFlagFor(uri: string): string {
  const canonicalId = uri.split("?")[0] ?? uri;
  if (uri.includes(`providerConfigId=${WORKERS_AI_CONFIG_ID}`)) {
    return `cf:${canonicalId}`;
  }
  return uri.includes("provider=openrouter") ? canonicalId : uri;
}

function providerConfigId(type: AIGatewayProviderConfig.Type["type"]): string {
  return `${type}-config-id`;
}

function workersAiBaseURL(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
}

export const modelURI = {
  openRouter: (model: string) =>
    AIGatewayModelURI.Schema.parse(
      `${model}?provider=openrouter&providerConfigId=${providerConfigId("openrouter")}`,
    ),
  /** `model` is a Workers AI id with the `@cf/` prefix already stripped. */
  workersAi: (model: string) =>
    AIGatewayModelURI.Schema.parse(
      `${model}?provider=openai-compatible&providerConfigId=${WORKERS_AI_CONFIG_ID}`,
    ),
};

export interface OpenRouterCatalog {
  /** Moving alias slug -> the build it stood for at run time. */
  aliasTargets: Map<string, string>;
  priceFor: (slug: string) => ModelPrice | undefined;
}

/** Per-token USD, as OpenRouter states it. */
interface ModelPrice {
  completion: number;
  prompt: number;
}

/**
 * Whether running this model spends metered credits.
 *
 * Workers AI is the one provider this project has credits sitting unused on, so
 * it is the free side of the line and everything else is the paid side. The
 * question is asked before a run starts rather than reported after it, since a
 * bill is not a result you can decline once it arrives.
 */
export function isPaidModel(uri: string): boolean {
  return !uri.includes(`providerConfigId=${WORKERS_AI_CONFIG_ID}`);
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

  if (env.CLOUDFLARE_WORKERS_AI_API_KEY && env.CLOUDFLARE_ACCOUNT_ID) {
    configs.push({
      apiKey: env.CLOUDFLARE_WORKERS_AI_API_KEY,
      baseURL: workersAiBaseURL(env.CLOUDFLARE_ACCOUNT_ID),
      cacheIdentifier,
      displayName: "Workers AI",
      id: AIProviderConfigIdSchema.parse(WORKERS_AI_CONFIG_ID),
      type: "openai-compatible",
    });
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
  // Only the models actually running through OpenRouter. Several Workers AI ids
  // are also OpenRouter slugs (`openai/gpt-oss-120b`, `zai-org/glm-5.3`), so
  // pricing them off this list bills a free run at another provider's rate.
  const slugs = modelURIs
    .filter((uri) => uri.includes("provider=openrouter"))
    .map((uri) => uri.split("?")[0] ?? uri);
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
