import { afterEach, expect, it, vi } from "vitest";

import { type AIGatewayProviderConfig } from "../../schemas/provider-config";
import { demoteSupersededModels } from "../demote-superseded-models";
import { readModelRelease } from "../read-model-release";
import { fetchAndParseXAIModels } from "./xai";

// The ids a Grok subscription's `/language-models` answered with on 2026-10-19.
const LISTED = [
  "grok-4.20-0309-non-reasoning",
  "grok-4.20-0309-reasoning",
  "grok-4.20-multi-agent-0309",
  "grok-4.3",
  "grok-4.5",
  "grok-4.6",
  "grok-4.7",
  "grok-build-0.1",
];

afterEach(() => {
  vi.unstubAllGlobals();
});

it("reads xAI's dated builds as releases of the numbered line", () => {
  expect(
    [
      "grok-4.20-0309-non-reasoning",
      "grok-4.20-multi-agent-0309",
      "grok-4.7",
    ].map((id) => readModelRelease(id)),
  ).toMatchObject([
    { build: 309, series: "grok|", version: 4.2 },
    { build: 309, series: "grok|", version: 4.2 },
    { build: undefined, series: "grok|", version: 4.7 },
  ]);
});

it("lists the chat models with the newest Grok as the one to start on", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      expect(url).toBe("https://api.x.ai/v1/language-models");
      return Promise.resolve(
        Response.json({
          models: LISTED.map((id) => ({ created: 1_773_014_400, id })),
        }),
      );
    }),
  );
  const config = {
    apiKey: "token",
    cacheIdentifier: "grok-account",
    id: "grok-account",
    type: "grok-account",
  } as AIGatewayProviderConfig.Type;

  const models = demoteSupersededModels(
    (await fetchAndParseXAIModels(config)).getOrThrow(),
  );

  expect(
    Object.fromEntries(
      models.map((model) => [
        model.canonicalId,
        `${model.author} ${model.tags.filter((tag) => tag !== "new").join(",")}`,
      ]),
    ),
  ).toMatchInlineSnapshot(`
    {
      "grok-4.20-0309-non-reasoning": "x-ai ",
      "grok-4.20-0309-reasoning": "x-ai ",
      "grok-4.20-multi-agent-0309": "x-ai ",
      "grok-4.3": "x-ai ",
      "grok-4.5": "x-ai coding",
      "grok-4.6": "x-ai coding",
      "grok-4.7": "x-ai coding,recommended,default",
      "grok-build-0.1": "x-ai ",
    }
  `);
});
