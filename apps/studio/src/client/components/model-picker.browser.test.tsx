import { ariaSnapshot } from "@/tests/aria-snapshot";
import { renderInBrowser } from "@/tests/render-browser";
import {
  AIGatewayModel,
  AIGatewayModelURI,
} from "@instrument-org/ai-gateway/schemas";
import { AIProviderConfigIdSchema, OUR_MODELS } from "@instrument-org/shared";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { ModelPicker } from "./model-picker";

// What the picker offers has to be legible from the accessibility tree, since
// that tree is both what a screen reader announces and what an agent driving
// the app reads. On Auto the model list is deliberately folded away, and a fold
// that leaves nothing behind is indistinguishable from a picker that has one
// model in it -- which is what an agent driving Studio concluded, before
// working around the UI entirely.

const params = {
  provider: "anthropic" as const,
  providerConfigId: AIProviderConfigIdSchema.parse("browser-test"),
};

const model = ({
  author = "anthropic",
  canonicalId,
  name,
  providerName = "Anthropic",
  tags = [],
}: {
  author?: string;
  canonicalId: string;
  name: string;
  providerName?: string;
  tags?: string[];
}) =>
  AIGatewayModel.Schema.parse({
    author,
    canonicalId,
    features: ["inputText", "outputText", "tools"],
    name,
    params,
    providerId: `${author}/${canonicalId}`,
    providerName,
    tags,
    uri: AIGatewayModelURI.fromModel({
      author,
      canonicalId: AIGatewayModel.CanonicalIdSchema.parse(canonicalId),
      params,
    }),
  });

const autoModel = AIGatewayModel.Schema.parse({
  author: OUR_MODELS.author,
  canonicalId: "auto",
  features: ["inputText", "outputText", "tools"],
  name: "Auto",
  params,
  providerId: OUR_MODELS.text.id,
  providerName: "Instrument",
  tags: [],
  uri: AIGatewayModelURI.fromModel({
    author: OUR_MODELS.author,
    canonicalId: AIGatewayModel.CanonicalIdSchema.parse("auto"),
    params,
  }),
});

const sonnet = model({
  canonicalId: "claude-sonnet-5",
  name: "Claude Sonnet 5",
  tags: ["recommended", "coding", "default"],
});

const models = [
  autoModel,
  model({
    canonicalId: "claude-opus-5",
    name: "Claude Opus 5",
    tags: ["recommended", "coding"],
  }),
  sonnet,
  model({ canonicalId: "claude-haiku-4-5", name: "Claude Haiku 4.5" }),
];

async function openPicker(selectedModel: AIGatewayModel.Type) {
  await renderInBrowser(
    <ModelPicker
      models={models}
      modelURI={selectedModel.uri}
      onValueChange={vi.fn()}
      selectedModel={selectedModel}
    />,
  );

  await userEvent.click(page.getByRole("combobox", { name: "Model" }));

  return () => ariaSnapshot("[data-slot=command]");
}

describe("ModelPicker in a browser", () => {
  it("says how many models the fold is holding while Auto is selected", async () => {
    const tree = await openPicker(autoModel);

    expect(await tree()).toMatchInlineSnapshot(`
      "- text: Search models Auto
      - switch "Auto Selects the best model for your task" [checked]
      - text: Selects the best model for your task
      - combobox "Search models" [expanded]
      - listbox "Suggestions"
      - button "Browse 3 models""
    `);
  });

  it("opens the list from the folded state without a search", async () => {
    const tree = await openPicker(autoModel);

    await userEvent.click(
      page.getByRole("button", { name: "Browse 3 models" }),
    );

    expect(await tree()).toMatchInlineSnapshot(`
      "- text: Search models Auto
      - switch "Auto Selects the best model for your task" [checked]
      - text: Selects the best model for your task
      - separator
      - combobox "Search models" [expanded]
      - listbox "Suggestions":
        - text: Recommended
        - option "Claude Opus 5 Anthropic" [selected]:
          - text: Claude Opus 5
          - img
          - text: Anthropic
        - option "Claude Sonnet 5 Anthropic":
          - text: Claude Sonnet 5
          - img
          - text: Anthropic
        - text: Other
        - option "Claude Haiku 4.5 Anthropic":
          - text: Claude Haiku 4.5
          - img
          - text: Anthropic"
    `);
  });

  it("names every model it offers while one is picked", async () => {
    const tree = await openPicker(sonnet);

    expect(await tree()).toMatchInlineSnapshot(`
      "- text: Search models Auto
      - switch "Auto Selects the best model for your task"
      - text: Selects the best model for your task
      - separator
      - combobox "Search models" [expanded]
      - listbox "Suggestions":
        - text: Recommended
        - option "Claude Opus 5 Anthropic" [selected]:
          - text: Claude Opus 5
          - img
          - text: Anthropic
        - option "Claude Sonnet 5 Anthropic":
          - text: Claude Sonnet 5
          - img
          - text: Anthropic
        - text: Other
        - option "Claude Haiku 4.5 Anthropic":
          - text: Claude Haiku 4.5
          - img
          - text: Anthropic"
    `);
  });
});
