import {
  AIGatewayModel,
  AIGatewayModelURI,
} from "@instrument-org/ai-gateway/schemas";
import { AIProviderConfigIdSchema, OUR_MODELS } from "@instrument-org/shared";
import {
  type SessionMessage,
  StoreId,
} from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { modelsAnswering } from "./models-answered";

const params = {
  provider: OUR_MODELS.providerType,
  providerConfigId: AIProviderConfigIdSchema.parse(OUR_MODELS.cacheIdentifier),
};

const model = ({
  author,
  canonicalId,
  name,
}: {
  author: string;
  canonicalId: string;
  name: string;
}) =>
  AIGatewayModel.Schema.parse({
    author,
    canonicalId,
    features: ["inputText", "outputText", "tools"],
    name,
    params,
    providerId: `${author}/${canonicalId}`,
    providerName: "Instrument",
    tags: [],
    uri: AIGatewayModelURI.fromModel({
      author,
      canonicalId: AIGatewayModel.CanonicalIdSchema.parse(canonicalId),
      params,
    }),
  });

const auto = model({ author: "instrument", canonicalId: "auto", name: "Auto" });
const luna = model({
  author: "openai",
  canonicalId: "gpt-5.6-luna",
  name: "GPT-5.6 Luna",
});
const haiku = model({
  author: "anthropic",
  canonicalId: "claude-haiku-4.5",
  name: "Claude Haiku 4.5",
});

const sessionId = StoreId.newSessionId();

function step({
  aiGatewayModel,
  aiGatewayModelServed,
  modelIdServed,
  synthetic,
}: {
  aiGatewayModel: AIGatewayModel.Type;
  aiGatewayModelServed?: AIGatewayModel.Type;
  modelIdServed?: string;
  synthetic?: boolean;
}): SessionMessage.AssistantWithParts {
  return {
    id: StoreId.newMessageId(),
    metadata: {
      aiGatewayModel,
      aiGatewayModelServed,
      createdAt: new Date("2026-08-29T00:00:00.000Z"),
      finishReason: "stop",
      modelId: aiGatewayModel.canonicalId,
      modelIdServed,
      providerId: aiGatewayModel.params.provider,
      sessionId,
      synthetic,
    },
    parts: [],
    role: "assistant",
  };
}

describe("modelsAnswering", () => {
  it("reads a turn the provider served as asked as ordinary", () => {
    expect(modelsAnswering([step({ aiGatewayModel: haiku })])).toMatchObject([
      { kind: "ordinary", served: [] },
    ]);
  });

  it("reads a router answered by another model as routed", () => {
    expect(
      modelsAnswering([
        step({
          aiGatewayModel: auto,
          aiGatewayModelServed: luna,
          modelIdServed: "openai/gpt-5.6-luna",
        }),
      ]),
    ).toMatchObject([
      {
        kind: "routed",
        requested: { providerId: OUR_MODELS.text.id },
        served: [{ model: { name: "GPT-5.6 Luna" } }],
      },
    ]);
  });

  it("reads a named model answered by another as substituted", () => {
    expect(
      modelsAnswering([
        step({
          aiGatewayModel: haiku,
          aiGatewayModelServed: luna,
          modelIdServed: "openai/gpt-5.6-luna",
        }),
      ]),
    ).toMatchObject([
      { kind: "substituted", served: [{ providerId: "openai/gpt-5.6-luna" }] },
    ]);
  });

  // The chips used to be keyed on what was requested, so a router picking twice
  // in one turn collapsed to one entry and the second model was unrecoverable.
  it("keeps both models a router picked across one turn", () => {
    const usages = modelsAnswering([
      step({
        aiGatewayModel: auto,
        aiGatewayModelServed: luna,
        modelIdServed: "openai/gpt-5.6-luna",
      }),
      step({
        aiGatewayModel: auto,
        aiGatewayModelServed: haiku,
        modelIdServed: "anthropic/claude-haiku-4.5",
      }),
    ]);

    expect(usages).toHaveLength(1);
    expect(usages[0]?.served.map((s) => s.providerId)).toEqual([
      "openai/gpt-5.6-luna",
      "anthropic/claude-haiku-4.5",
    ]);
  });

  // A message written before the field held only differences carries the
  // requested id back as though a provider had named it.
  it("ignores a served id that names the model that was requested", () => {
    expect(
      modelsAnswering([
        step({
          aiGatewayModel: haiku,
          modelIdServed: "anthropic/claude-haiku-4.5",
        }),
      ]),
    ).toMatchObject([{ kind: "ordinary", served: [] }]);
  });

  it("keeps the served id when the catalog has no record of it", () => {
    expect(
      modelsAnswering([
        step({
          aiGatewayModel: auto,
          modelIdServed: "openai/gpt-5.7-preview",
        }),
      ]),
    ).toMatchObject([
      {
        kind: "routed",
        served: [{ model: undefined, providerId: "openai/gpt-5.7-preview" }],
      },
    ]);
  });

  it("leaves out messages the workspace wrote itself", () => {
    expect(
      modelsAnswering([step({ aiGatewayModel: haiku, synthetic: true })]),
    ).toEqual([]);
  });
});
