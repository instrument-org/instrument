import { describe, expect, it } from "vitest";

import {
  workersAiTestAccountId,
  workersAiTestOpenAiCompatBaseUrl,
} from "../../test/workers-ai-fixtures";
import {
  isWorkersAiProviderConfig,
  parseWorkersAiOpenAiCompatBaseUrl,
  workersAiModelsSearchUrl,
} from "./parse-workers-ai-base-url";

describe("parseWorkersAiOpenAiCompatBaseUrl", () => {
  it("extracts the account id from the OpenAI-compat base URL", () => {
    expect(
      parseWorkersAiOpenAiCompatBaseUrl(workersAiTestOpenAiCompatBaseUrl),
    ).toEqual({ accountId: workersAiTestAccountId });
  });

  it("returns null for non-Workers-AI URLs", () => {
    expect(parseWorkersAiOpenAiCompatBaseUrl("https://api.openai.com/v1")).toBe(
      null,
    );
  });
});

describe("isWorkersAiProviderConfig", () => {
  it("is true for a Cloudflare Workers AI OpenAI-compat base URL", () => {
    expect(
      isWorkersAiProviderConfig({
        baseURL: workersAiTestOpenAiCompatBaseUrl,
        type: "openai-compatible",
      }),
    ).toBe(true);
  });
});

describe("workersAiModelsSearchUrl", () => {
  it("builds the account models search endpoint with query params", () => {
    expect(
      workersAiModelsSearchUrl("abc123", {
        hide_experimental: true,
        page: 2,
        per_page: 50,
        task: "Text Generation",
      }),
    ).toBe(
      "https://api.cloudflare.com/client/v4/accounts/abc123/ai/models/search?format=openrouter&task=Text+Generation&hide_experimental=true&page=2&per_page=50",
    );
  });
});
