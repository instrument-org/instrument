import { renderInBrowser } from "@/tests/render-browser";
import {
  AIGatewayModel,
  AIGatewayModelURI,
} from "@instrument-org/ai-gateway/schemas";
import { AIProviderConfigIdSchema } from "@instrument-org/shared";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import { ModelChip } from "./model-chip";

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

it("names the model that answered without dropping the one that was asked for", async () => {
  await renderInBrowser(<ModelChip aiGatewayModel={fable} replacedBy="Opus 5" />);

  await expect.element(page.getByText("Fable 5")).toBeVisible();
  await expect.element(page.getByText("Opus 5")).toBeVisible();
  expect(page.getByText("Fable 5").element()).toHaveStyle({
    textDecorationLine: "line-through",
  });
});

it("draws one name when the provider served what was asked for", async () => {
  await renderInBrowser(<ModelChip aiGatewayModel={fable} />);

  await expect.element(page.getByText("Fable 5")).toBeVisible();
  expect(page.getByText("Fable 5").element()).not.toHaveStyle({
    textDecorationLine: "line-through",
  });
});
