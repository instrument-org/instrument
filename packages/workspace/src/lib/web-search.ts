import { type LanguageModelV3Source } from "@ai-sdk/provider";
import {
  type AIGatewayModel,
  type AIGatewayProviderConfig,
  getWebSearchModel,
} from "@instrument-org/ai-gateway";
import { OUR_MODELS, type WorkspaceServerURL } from "@instrument-org/shared";
import { APICallError, type LanguageModelUsage, streamText } from "ai";
import { err, ok, type Result } from "neverthrow";
import { dedent } from "radashi";

import { type WebSearchResult } from "../schemas/web-search";
import { type WorkspaceConfig } from "../types";
import { TypedError } from "./errors";
import { getCurrentDate } from "./get-current-date";

export interface WebSearchFailure {
  errorMessage: string;
  errorType: "api-call" | "no-search-backend" | "not-authenticated";
  responseBody?: string;
}

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
  signal,
  workspaceConfig,
  workspaceServerURL,
}: {
  callingModel: AIGatewayModel.Type;
  configs: AIGatewayProviderConfig.Type[];
  prompt: string;
  signal: AbortSignal;
  workspaceConfig: WorkspaceConfig;
  workspaceServerURL: WorkspaceServerURL;
}): AsyncGenerator<Result<WebSearchResults, WebSearchFailure>> {
  // Our search endpoint meters against the signed-in user's credits, so it only
  // serves the models we already bill for. A model running on a key the user
  // brought searches through that provider instead: that is the option costing
  // them nothing extra, and it needs no second API key from them.
  if (callingModel.params.provider === OUR_MODELS.providerType) {
    yield await searchWithPlatform({ prompt, signal, workspaceConfig });
    return;
  }

  yield* searchWithProviderModel({
    callingModel,
    configs,
    prompt,
    signal,
    workspaceConfig,
    workspaceServerURL,
  });
}

function getPerplexityResults(output: unknown) {
  if (!output || typeof output !== "object" || !("results" in output)) {
    return [];
  }

  const rawResults = getUnknownProperty(output, "results");
  if (!Array.isArray(rawResults)) {
    return [];
  }

  const results: unknown[] = rawResults;
  return results.filter(
    (
      result,
    ): result is {
      date?: string;
      snippet: string;
      title: string;
      url: string;
    } =>
      typeof result === "object" &&
      result !== null &&
      hasStringProperty(result, "snippet") &&
      hasStringProperty(result, "title") &&
      hasStringProperty(result, "url"),
  );
}

function getUnknownProperty(value: object, property: string): unknown {
  return Object.getOwnPropertyDescriptor(value, property)?.value;
}

function hasStringProperty(
  value: object,
  property: "snippet" | "title" | "url",
) {
  return typeof getUnknownProperty(value, property) === "string";
}

function searchSystemPrompt() {
  const today = getCurrentDate().toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return dedent`
    You research a query using the search results you retrieve now. Today is ${today}. Never answer from memory.

    - Keep the wording of each source rather than paraphrasing it, and give the date a page was published or last updated whenever it shows one.
    - Every specific claim -- a name, version, price, tier, model, or date -- must come from a result you actually retrieved, attributed to the page it came from. Leave out anything you did not find.
    - When results disagree, or the query turns on something you could not confirm, say so plainly instead of settling on the most plausible answer.
    - A proper noun that matches nothing may be misspelled or misheard. Search the closest real name, and say which name you searched.
  `;
}

async function searchWithPlatform({
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
      errorType:
        response.errorType === "not-authenticated"
          ? "not-authenticated"
          : "api-call",
      responseBody: response.responseBody,
    });
  }

  return ok({
    costDollars: response.data.costDollars,
    kind: "excerpts",
    sources: response.data.results,
  });
}

async function* searchWithProviderModel({
  callingModel,
  configs,
  prompt,
  signal,
  workspaceConfig,
  workspaceServerURL,
}: {
  callingModel: AIGatewayModel.Type;
  configs: AIGatewayProviderConfig.Type[];
  prompt: string;
  signal: AbortSignal;
  workspaceConfig: WorkspaceConfig;
  workspaceServerURL: WorkspaceServerURL;
}): AsyncGenerator<Result<WebSearchResults, WebSearchFailure>> {
  const modelResult = await getWebSearchModel({
    callingModel,
    configs,
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

  const currentResult = () =>
    ok({
      kind: "summary" as const,
      modelId: model.modelId,
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
      model,
      prompt,
      providerOptions,
      system: searchSystemPrompt(),
      tools,
    });

    for await (const part of textResult.fullStream) {
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

function urlSource(source: LanguageModelV3Source): undefined | WebSearchSource {
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
