import { type LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";

import { getWorkspaceServerURL } from "../logic/server/url";
import { TaskIdSchema } from "../schemas/task-id";
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

async function runWebSearch(chunks: LanguageModelV3StreamPart[]) {
  const model = createMockAIGatewayModel();
  const searchModel = new MockLanguageModelV3({
    doStream: () =>
      Promise.resolve({
        stream: simulateReadableStream({ chunks: [...chunks, finishPart] }),
      }),
  });

  createMockTaskConfig(TaskIdSchema.parse("2026-07-27-web-search"), {
    model,
    webSearchModel: { model: searchModel },
  });

  const workspaceConfig = getWorkspaceConfig();
  const results = [];
  for await (const result of webSearch({
    callingModel: model,
    configs: getWorkspaceConfig().getAIProviderConfigs(),
    prompt: "what changed recently",
    signal: new AbortController().signal,
    workspaceConfig,
    workspaceServerURL: getWorkspaceServerURL(),
  })) {
    results.push(result);
  }

  const last = results.at(-1);
  if (!last || last.isErr()) {
    throw new Error(
      `Expected a successful search, got ${JSON.stringify(last)}`,
    );
  }

  return { searchModel, value: last.value };
}

describe("webSearch", () => {
  it("keeps snippets from every search alongside the model's prose", async () => {
    const { value } = await runWebSearch([
      perplexityResult({
        results: [
          { snippet: "First snippet.", title: "One", url: "https://one.test" },
        ],
        toolCallId: "call-1",
      }),
      ...textDelta("Summarizing both searches."),
      perplexityResult({
        results: [
          { snippet: "Second snippet.", title: "Two", url: "https://two.test" },
        ],
        toolCallId: "call-2",
      }),
    ]);

    expect(value.text).toMatchInlineSnapshot(`
      "First snippet.

      Second snippet.

      Summarizing both searches."
    `);
    expect(value.sources.map((source) => source.id)).toMatchInlineSnapshot(`
      [
        "perplexity-0",
        "perplexity-1",
      ]
    `);
  });

  it("grounds the search model with the current date", async () => {
    const { searchModel } = await runWebSearch(textDelta("An answer."));

    const system = searchModel.doStreamCalls[0]?.prompt.find(
      (message) => message.role === "system",
    );

    expect(system).toBeDefined();
    expect(JSON.stringify(system)).toContain("Today is");
  });
});
