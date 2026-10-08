import { type LanguageModelV4Source } from "@ai-sdk/provider";
import {
  type AIGatewayModel,
  type AIGatewayProviderConfig,
  CLIENT_SESSION_ID_HEADER,
  getWebSearchModel,
  namesSameModel,
} from "@instrument-org/ai-gateway";
import { OUR_MODELS, type WorkspaceServerURL } from "@instrument-org/shared";
import { APICallError, type LanguageModelUsage, streamText } from "ai";
import { err, ok, type Result } from "neverthrow";
import { dedent } from "radashi";
import { z } from "zod";

import { type StoreId } from "../schemas/store-id";
import { type WebSearchResult } from "../schemas/web-search";
import { type WorkspaceConfig } from "../types";
import { TypedError } from "./errors";
import { getCurrentDate } from "./get-current-date";

export interface WebSearchFailure {
  errorMessage: string;
  errorType:
    | "api-call"
    | "no-search-backend"
    | "not-authenticated"
    | "payment-required";
  responseBody?: string;
}

// Failures the user has to resolve. Falling back on these would spend the same
// credits down the other path, fail the same way, and bury the reason under
// twice the wait, so they surface instead.
const USER_ACTIONABLE = new Set<WebSearchFailure["errorType"]>([
  "not-authenticated",
  "payment-required",
]);

// Our search endpoint answers a burst with a rate limit that clears almost at
// once. One short retry usually gets the
// better backend back rather than spending the rest of the task on the weaker
// one; the provider's own search is the floor, not the target.
const RETRY_DELAY_MS = 250;

/**
 * The two backends return genuinely different things, so they stay separate all
 * the way out to the UI rather than being flattened into one shape: our search
 * endpoint returns verbatim excerpts of the pages it ranked, while a provider's
 * search-capable model returns prose it wrote about the pages it read.
 */
export type WebSearchResults =
  | {
      costDollars: number;
      kind: "excerpts";
      sources: WebSearchResult[];
    }
  | {
      kind: "summary";
      modelId: string;
      /**
       * What the provider reports having served, when that is a different model
       * from the one the search was routed to. The search model is picked for
       * the user rather than by them, so which one actually answered is the
       * only way to attribute a search after the fact.
       */
      modelIdServed?: string;
      provider: AIGatewayProviderConfig.Type;
      sources: WebSearchSource[];
      text: string;
      usage: {
        inputTokens: number | undefined;
        outputTokens: number | undefined;
        totalTokens: number | undefined;
      };
    };

interface WebSearchSource {
  title?: string;
  url: string;
}

const emptyUsage: Extract<WebSearchResults, { kind: "summary" }>["usage"] = {
  inputTokens: undefined,
  outputTokens: undefined,
  totalTokens: undefined,
};

export async function* webSearch({
  callingModel,
  configs,
  prompt,
  sessionId,
  signal,
  workspaceConfig,
  workspaceServerURL,
}: {
  callingModel: AIGatewayModel.Type;
  configs: AIGatewayProviderConfig.Type[];
  prompt: string;
  sessionId: StoreId.Session;
  signal: AbortSignal;
  workspaceConfig: WorkspaceConfig;
  workspaceServerURL: WorkspaceServerURL;
}): AsyncGenerator<Result<WebSearchResults, WebSearchFailure>> {
  // A model on our provider searches through our endpoint first. A model on a
  // key the user brought searches through that provider, which needs no second
  // API key from them.
  if (callingModel.params.provider === OUR_MODELS.providerType) {
    const platformResult = await searchWithPlatform({
      prompt,
      signal,
      workspaceConfig,
    });
    if (
      platformResult.isOk() ||
      USER_ACTIONABLE.has(platformResult.error.errorType)
    ) {
      yield platformResult;
      return;
    }
  }

  // Reached either because the model runs on the user's own key, or because our
  // endpoint is rate limited, switched off, or down. The user asked for a
  // search, so run one on the provider rather than hand back an error; the
  // result names its own kind, so nothing downstream is told it got excerpts.
  for await (const result of searchWithProviderModel({
    callingModel,
    configs,
    prompt,
    sessionId,
    signal,
    workspaceConfig,
    workspaceServerURL,
  })) {
    // A provider with no search of its own (an OpenAI-compatible endpoint, say)
    // leaves ours as the only backend, which beats the agent's alternative of
    // minutes of fetching pages by hand.
    if (
      result.isErr() &&
      result.error.errorType === "no-search-backend" &&
      callingModel.params.provider !== OUR_MODELS.providerType
    ) {
      yield await searchWithPlatform({ prompt, signal, workspaceConfig });
      return;
    }
    yield result;
  }
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

// Perplexity's tool output is not part of any provider contract the SDK types,
// so it is parsed here. Entries missing a field are dropped rather than failing
// the whole result set: a partial list of sources is still worth showing.
const PerplexityResultSchema = z.object({
  snippet: z.string(),
  title: z.string(),
  url: z.string(),
});

const PerplexityOutputSchema = z.object({
  results: z.array(z.unknown()),
});

function getPerplexityResults(output: unknown) {
  const parsed = PerplexityOutputSchema.safeParse(output);
  if (!parsed.success) {
    return [];
  }

  return parsed.data.results
    .map((result) => PerplexityResultSchema.safeParse(result))
    .filter((result) => result.success)
    .map((result) => result.data);
}

async function requestPlatformSearch({
  prompt,
  signal,
  workspaceConfig,
}: {
  prompt: string;
  signal: AbortSignal;
  workspaceConfig: WorkspaceConfig;
}): Promise<Result<WebSearchResults, WebSearchFailure>> {
  const response = await workspaceConfig.webSearch({
    input: { query: prompt },
    signal,
  });

  if (!response.ok) {
    return err({
      errorMessage: response.errorMessage,
      // Keep the reasons the user can act on distinct from a generic failure:
      // it is what decides whether this falls back or surfaces.
      errorType:
        response.errorType === "request-failed"
          ? "api-call"
          : response.errorType,
      responseBody: response.responseBody,
    });
  }

  return ok({
    costDollars: response.data.costDollars,
    kind: "excerpts",
    sources: response.data.results,
  });
}

function searchSystemPrompt() {
  const today = getCurrentDate().toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // One search and a short reply are what keep this a lookup. Left to itself a
  // search model searches two or three times and writes up to 650 words, which
  // measured at two to three times the latency of this prompt on the ChatGPT
  // plan and on OpenRouter with no loss of the facts, dates, or sources; the
  // agent asking can search again or fetch a page when it needs more.
  return dedent`
    You look up a query on the web now and report what you find. Today is ${today}. Never answer from memory.

    - Search once. Search again only when the first results miss the query entirely; a proper noun that matches nothing may be misspelled or misheard, so search the closest real name and say which name you searched.
    - Reply in at most 150 words: the facts that answer the query, each attributed to the page it came from, with the date the page shows when it shows one. Keep the source's own wording for names, numbers, prices, versions, and dates.
    - Leave out anything you did not find. When results disagree, or the query turns on something you could not confirm, say so plainly.
  `;
}

async function searchWithPlatform(args: {
  prompt: string;
  signal: AbortSignal;
  workspaceConfig: WorkspaceConfig;
}): Promise<Result<WebSearchResults, WebSearchFailure>> {
  const first = await requestPlatformSearch(args);

  if (first.isOk() || USER_ACTIONABLE.has(first.error.errorType)) {
    return first;
  }

  await delay(RETRY_DELAY_MS, args.signal);
  return args.signal.aborted ? first : requestPlatformSearch(args);
}

async function* searchWithProviderModel({
  callingModel,
  configs,
  prompt,
  sessionId,
  signal,
  workspaceConfig,
  workspaceServerURL,
}: {
  callingModel: AIGatewayModel.Type;
  configs: AIGatewayProviderConfig.Type[];
  prompt: string;
  sessionId: StoreId.Session;
  signal: AbortSignal;
  workspaceConfig: WorkspaceConfig;
  workspaceServerURL: WorkspaceServerURL;
}): AsyncGenerator<Result<WebSearchResults, WebSearchFailure>> {
  const modelResult = await getWebSearchModel({
    callingModel,
    configs,
    modelCache: workspaceConfig.modelCache,
    workspaceServerURL,
  });

  const [resolved, modelError] = modelResult.toTuple();

  if (modelError) {
    yield err({
      errorMessage: modelError.message,
      errorType: "no-search-backend",
    });
    return;
  }

  const { config, model, providerOptions, tools } = resolved;
  const sources: WebSearchSource[] = [];
  // Retrieved snippets and the model's own prose accumulate separately so a
  // second search cannot discard what an earlier one returned.
  const snippets: string[] = [];
  let generatedText = "";
  let usage = emptyUsage;

  let modelIdServed: string | undefined;

  const currentResult = () =>
    ok({
      kind: "summary" as const,
      modelId: model.modelId,
      modelIdServed,
      provider: config,
      sources,
      text: [...snippets, generatedText]
        .filter((part) => part !== "")
        .join("\n\n"),
      usage,
    });

  try {
    const textResult = streamText({
      abortSignal: signal,
      // A search runs inside a turn, so it groups with the turn that asked for it.
      headers: { [CLIENT_SESSION_ID_HEADER]: sessionId },
      instructions: searchSystemPrompt(),
      model,
      prompt,
      providerOptions,
      tools,
    });

    for await (const part of textResult.stream) {
      switch (part.type) {
        case "abort": {
          return;
        }
        case "error": {
          throw part.error;
        }
        case "finish": {
          usage = usageFrom(part.totalUsage);
          yield currentResult();
          break;
        }
        case "finish-step": {
          // Same rule as an agent turn: the SDK seeds this with the id we sent
          // and only overwrites it when the provider reports one, so only a
          // difference can have come from the provider.
          if (!namesSameModel(model.modelId, part.response.modelId)) {
            modelIdServed = part.response.modelId;
          }
          break;
        }
        case "source": {
          const source = urlSource(part);
          if (source) {
            sources.push(source);
            yield currentResult();
          }
          break;
        }
        case "text-delta": {
          generatedText += part.text;
          yield currentResult();
          break;
        }
        case "tool-result": {
          if (part.toolName !== "perplexity_search") {
            break;
          }

          const perplexityResults = getPerplexityResults(part.output);
          if (perplexityResults.length === 0) {
            break;
          }

          snippets.push(...perplexityResults.map((r) => r.snippet));
          sources.push(
            ...perplexityResults.map((r) => ({ title: r.title, url: r.url })),
          );
          yield currentResult();
          break;
        }
      }
    }
  } catch (generationError) {
    const message = `Failed to perform web search: ${generationError instanceof Error ? generationError.message : "Unknown error"}`;
    const responseBody = APICallError.isInstance(generationError)
      ? generationError.responseBody
      : undefined;
    workspaceConfig.captureException(
      new TypedError.APICall(message, {
        cause: generationError,
        responseBody,
      }),
    );
    yield err({ errorMessage: message, errorType: "api-call", responseBody });
  }
}

function urlSource(source: LanguageModelV4Source): undefined | WebSearchSource {
  return source.sourceType === "url"
    ? { title: source.title, url: source.url }
    : undefined;
}

function usageFrom(usage: LanguageModelUsage) {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}
