import {
  type LanguageModelV3Source,
} from "@ai-sdk/provider";
import {
  type AIGatewayModel,
  type AIGatewayProviderConfig,
  type AIGatewayTypedError,
  getWebSearchModel,
} from "@instrument-org/ai-gateway";
import {
  type WorkspaceServerURL,
} from "@instrument-org/shared";
import {
  APICallError,
  type LanguageModelUsage,
  streamText,
} from "ai";
import {
  err,
  ok,
  type Result,
} from "neverthrow";

import {
  type WorkspaceConfig,
} from "../types";
import {
  TypedError,
} from "./errors";

type WebSearchError = AIGatewayTypedError.NotFound | TypedError.APICall;

interface WebSearchResult {
  modelId: string;
  provider: AIGatewayProviderConfig.Type;
  sources: LanguageModelV3Source[];
  text: string;
  usage: {
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    totalTokens: number | undefined;
  };
}

const emptyUsage: WebSearchResult["usage"] = {
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
}): AsyncGenerator<Result<WebSearchResult, WebSearchError>> {
  const modelResult = await getWebSearchModel({
    callingModel,
    configs,
    workspaceServerURL,
  });

  const [resolved, modelError] = modelResult.toTuple();

  if (modelError) {
    yield err(modelError);
    return;
  }

  const { config, model, providerOptions, tools } = resolved;
  const sources: LanguageModelV3Source[] = [];
  let text = "";
  let usage = emptyUsage;

  const currentResult = () =>
    ok({
      modelId: model.modelId,
      provider: config,
      sources,
      text,
      usage,
    });

  try {
    const textResult = streamText({
      abortSignal: signal,
      model,
      prompt,
      providerOptions,
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
          sources.push(part);
          yield currentResult();
          break;
        }
        case "text-delta": {
          text += part.text;
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

          text = perplexityResults.map((r) => r.snippet).join("\n\n");
          sources.push(
            ...perplexityResults.map((r, i) => ({
              id: `perplexity-${i}`,
              sourceType: "url" as const,
              title: r.title,
              type: "source" as const,
              url: r.url,
            })),
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
    const error = new TypedError.APICall(message, {
      cause: generationError,
      responseBody,
    });
    workspaceConfig.captureException(error);
    yield err(error);
  }
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

function usageFrom(usage: LanguageModelUsage) {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}
