import { type LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import { getWorkspaceServerURL } from "../logic/server/url";
import { TaskIdSchema } from "../schemas/task-id";
import { type WebSearchClient } from "../schemas/web-search";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { webSearch } from "./web-search";
import { getWorkspaceConfig } from "./workspace-config";

function perplexityResult({
  results,
  toolCallId,
}: {
  results: { snippet: string; title: string; url: string }[];
  toolCallId: string;
}): LanguageModelV3StreamPart {
  return {
    result: { results },
    toolCallId,
    toolName: "perplexity_search",
    type: "tool-result",
  };
}

function textDelta(delta: string): LanguageModelV3StreamPart[] {
  return [
    { id: "1", type: "text-start" },
    { delta, id: "1", type: "text-delta" },
    { id: "1", type: "text-end" },
  ];
}

const finishPart: LanguageModelV3StreamPart = {
  finishReason: { raw: "stop", unified: "stop" },
  type: "finish",
  usage: {
    inputTokens: {
      cacheRead: undefined,
      cacheWrite: undefined,
      noCache: undefined,
      total: 10,
    },
    outputTokens: { reasoning: undefined, text: undefined, total: 20 },
  },
};

async function collect(callingModel: AIGatewayModel.Type) {
  const workspaceConfig = getWorkspaceConfig();
  const results = [];
  for await (const result of webSearch({
    callingModel,
    configs: workspaceConfig.getAIProviderConfigs(),
    prompt: "what changed recently",
    signal: new AbortController().signal,
    workspaceConfig,
    workspaceServerURL: getWorkspaceServerURL(),
  })) {
    results.push(result);
  }
  return results;
}

const rejectingWebSearchClient: WebSearchClient = () => {
  throw new Error("The platform search endpoint must not be called");
};

/** A model on a key the user brought, which searches through that provider. */
async function runProviderSearch(chunks: LanguageModelV3StreamPart[]) {
  const model = createMockAIGatewayModel({ provider: "openrouter" });
  const searchModel = new MockLanguageModelV3({
    doStream: () =>
      Promise.resolve({
        stream: simulateReadableStream({ chunks: [...chunks, finishPart] }),
      }),
  });

  createMockTaskConfig(TaskIdSchema.parse("2026-07-27-web-search-provider"), {
    model,
    webSearch: rejectingWebSearchClient,
    webSearchModel: { model: searchModel },
  });

  const results = await collect(model);
  const last = results.at(-1);
  if (!last || last.isErr()) {
    throw new Error(
      `Expected a successful search, got ${JSON.stringify(last)}`,
    );
  }
  if (last.value.kind !== "summary") {
    throw new Error(`Expected a summary, got ${last.value.kind}`);
  }

  return { searchModel, value: last.value };
}

describe("webSearch", () => {
  describe("a model on the user's own key", () => {
    it("keeps snippets from every search alongside the model's prose", async () => {
      const { value } = await runProviderSearch([
        perplexityResult({
          results: [
            {
              snippet: "First snippet.",
              title: "One",
              url: "https://one.test",
            },
          ],
          toolCallId: "call-1",
        }),
        ...textDelta("Summarizing both searches."),
        perplexityResult({
          results: [
            {
              snippet: "Second snippet.",
              title: "Two",
              url: "https://two.test",
            },
          ],
          toolCallId: "call-2",
        }),
      ]);

      expect(value.text).toMatchInlineSnapshot(`
        "First snippet.

        Second snippet.

        Summarizing both searches."
      `);
      expect(value.sources).toMatchInlineSnapshot(`
        [
          {
            "title": "One",
            "url": "https://one.test",
          },
          {
            "title": "Two",
            "url": "https://two.test",
          },
        ]
      `);
    });

    it("grounds the search model with the current date", async () => {
      const { searchModel } = await runProviderSearch(textDelta("An answer."));

      const system = searchModel.doStreamCalls[0]?.prompt.find(
        (message) => message.role === "system",
      );

      expect(system).toBeDefined();
      expect(JSON.stringify(system)).toContain("Today is");
    });
  });

  describe("a first-party model", () => {
    it("searches through the platform endpoint", async () => {
      const model = createMockAIGatewayModel();
      const searchWeb = vi.fn<WebSearchClient>(() =>
        Promise.resolve({
          data: {
            costDollars: 0.007,
            results: [
              {
                publishedDate: "2026-07-01",
                text: "The passage that matched.",
                title: "One",
                url: "https://one.test",
              },
            ],
          },
          ok: true,
        }),
      );

      createMockTaskConfig(
        TaskIdSchema.parse("2026-07-27-web-search-platform"),
        {
          model,
          webSearch: searchWeb,
        },
      );

      const results = await collect(model);

      expect(searchWeb.mock.calls[0]?.[0].input).toEqual({
        query: "what changed recently",
      });
      expect(results.map((r) => r._unsafeUnwrap())).toMatchInlineSnapshot(`
        [
          {
            "costDollars": 0.007,
            "kind": "excerpts",
            "sources": [
              {
                "publishedDate": "2026-07-01",
                "text": "The passage that matched.",
                "title": "One",
                "url": "https://one.test",
              },
            ],
          },
        ]
      `);
    });

    it("reports a signed-out user instead of falling back to a provider", async () => {
      const model = createMockAIGatewayModel();

      createMockTaskConfig(TaskIdSchema.parse("2026-07-27-web-search-out"), {
        model,
        webSearch: () =>
          Promise.resolve({
            errorMessage: "Sign in to search the web.",
            errorType: "not-authenticated",
            ok: false,
          }),
      });

      const results = await collect(model);

      expect(results.map((r) => r._unsafeUnwrapErr())).toMatchInlineSnapshot(`
        [
          {
            "errorMessage": "Sign in to search the web.",
            "errorType": "not-authenticated",
            "responseBody": undefined,
          },
        ]
      `);
    });
  });
});
