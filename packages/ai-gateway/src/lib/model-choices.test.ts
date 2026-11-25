import { beforeEach, describe, expect, it } from "vitest";

import { AIGatewayModel } from "../schemas/model";
import {
  applyServedModelSettings,
  choiceProviderOptions,
  modelChoicesFor,
  takenChoice,
} from "./model-choices";
import { noteReportedFastMode } from "./reported-fast-mode";

function model(
  provider: string,
  extra: Record<string, unknown> = {},
): AIGatewayModel.Type {
  const params = { provider, providerConfigId: "pc_1" };
  return AIGatewayModel.Schema.parse({
    author: "maker",
    canonicalId: "some-model",
    features: ["inputText", "outputText"],
    name: "Some Model",
    params,
    providerId: "some-model",
    providerName: "Provider",
    tags: [],
    uri: `maker/some-model?provider=${provider}&providerConfigId=pc_1`,
    ...extra,
  });
}

const account = model("claude-account", {
  fast: {},
  reasoning: {
    defaultEffort: "medium",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    enabledByDefault: true,
    mandatory: false,
  },
});
const choice = {
  effort: "high",
  fast: true,
  model: AIGatewayModel.CanonicalIdSchema.parse("some-model"),
  provider: "claude-account",
};

beforeEach(() => {
  noteReportedFastMode("pc_1", undefined);
  applyServedModelSettings({
    connections: {
      "claude-account": { labels: { xhigh: "Extra" } },
      google: {
        models: { "some-model": { efforts: ["low", "high", "xhigh"] } },
      },
      openai: {
        models: {
          "some-model": {
            defaultEffort: "low",
            efforts: ["none", "low", "max"],
            fast: { param: "priority" },
          },
        },
        refusedEfforts: ["max"],
      },
    },
  });
});

describe("modelChoicesFor", () => {
  it("offers an account's own levels under the names our API gives", () => {
    const choices = modelChoicesFor(account);
    expect(choices?.efforts.map(({ label }) => label)).toEqual([
      "Low",
      "Medium",
      "High",
      "Extra",
      "Max",
    ]);
    expect(choices?.defaultLabel).toBe("Medium");
  });

  it("leaves out levels the connection refuses or the SDK cannot send", () => {
    expect(
      modelChoicesFor(model("google"))?.efforts.map(({ id }) => id),
    ).toEqual(["low", "high"]);
    // One level left is no choice, and Fast still is.
    expect(modelChoicesFor(model("openai"))).toMatchObject({
      efforts: [],
      fast: {},
    });
  });

  it("offers nothing where nothing is known, and keeps the last settings over ones it cannot read", () => {
    expect(modelChoicesFor(model("x-ai"))).toBeUndefined();
    expect(applyServedModelSettings({ connections: "gone" })).toBe(false);
    expect(modelChoicesFor(model("google"))).toBeDefined();
  });

  it("says why Claude turned Fast off", () => {
    noteReportedFastMode("pc_1", "extra_usage_disabled");
    expect(modelChoicesFor(account)?.fast?.off?.row).toBe(
      "Usage credits are off",
    );
    noteReportedFastMode("pc_1", "network_error");
    expect(modelChoicesFor(account)?.fast?.off?.row).toBe("Not available");
  });
});

describe("takenChoice", () => {
  it("takes nothing made for another model or connection", () => {
    expect(takenChoice(account, choice)).toEqual({
      effort: "high",
      fast: true,
    });
    expect(takenChoice(account, { ...choice, provider: "anthropic" })).toEqual(
      {},
    );
    expect(
      takenChoice(account, {
        ...choice,
        model: AIGatewayModel.CanonicalIdSchema.parse("other"),
      }),
    ).toEqual({});
  });

  it("drops a level the model lost and Fast its account cannot run", () => {
    noteReportedFastMode("pc_1", "free");
    expect(takenChoice(account, { ...choice, effort: "ultra" })).toEqual({});
  });
});

it("asks each provider in its own words", () => {
  const taken = { effort: "max", fast: true as const };
  expect(
    ["anthropic.messages", "openai.responses", "claude-account"].map((id) =>
      choiceProviderOptions(id, taken),
    ),
  ).toEqual([
    { anthropic: { effort: "max", speed: "fast" } },
    {
      openai: {
        reasoningEffort: "max",
        reasoningSummary: null,
        serviceTier: "priority",
      },
    },
    { "claude-account": { effort: "max", fast: true } },
  ]);
});
