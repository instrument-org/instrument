import { renderInBrowser } from "@/tests/render-browser";
import {
  AIGatewayModel,
  AIGatewayModelURI,
} from "@instrument-org/ai-gateway/schemas";
import { AIProviderConfigIdSchema } from "@instrument-org/shared";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import { ModelUsageChip } from "./model-usage-chip";

const params = {
  provider: "anthropic" as const,
  providerConfigId: AIProviderConfigIdSchema.parse("browser-test"),
};

const fable = AIGatewayModel.Schema.parse({
  author: "anthropic",
  canonicalId: "fable-5",
  features: ["inputText", "outputText", "tools"],
  name: "Fable 5",
  params,
  providerId: "anthropic/fable-5",
  providerName: "Anthropic",
  tags: [],
  uri: AIGatewayModelURI.fromModel({
    author: "anthropic",
    canonicalId: AIGatewayModel.CanonicalIdSchema.parse("fable-5"),
    params,
  }),
});

it("names the model that answered in place of the one asked for", async () => {
  await renderInBrowser(
    <ModelUsageChip
      usage={{
        kind: "substituted",
        modelId: "fable-5",
        requested: fable,
        served: [{ providerId: "Opus 5" }],
      }}
    />,
  );

  await expect.element(page.getByText("Opus 5")).toBeVisible();
  await expect.element(page.getByText("Fable 5")).not.toBeInTheDocument();
});

it("names the model asked for when the provider served it", async () => {
  await renderInBrowser(
    <ModelUsageChip
      usage={{
        kind: "ordinary",
        modelId: "fable-5",
        requested: fable,
        served: [],
      }}
    />,
  );

  await expect.element(page.getByText("Fable 5")).toBeVisible();
});
