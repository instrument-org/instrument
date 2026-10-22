import {
  type AIProviderConfigId,
  type AIProviderType,
  OUR_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { selectImageProviderConfigs } from "./get-ai-sdk-image-model";

function config(type: AIProviderType, id: string = type) {
  return {
    apiKey: "test-key",
    cacheIdentifier: `cache-${id}`,
    // A test id stands for whatever the store minted.
    id: id as AIProviderConfigId,
    type,
  } satisfies AIGatewayProviderConfig.Type;
}

const ours = config(OUR_PROVIDER_CONFIG.type, OUR_PROVIDER_CONFIG.id);

function order(chatOn: string, configs: AIGatewayProviderConfig.Type[]) {
  return selectImageProviderConfigs({
    callingModel: {
      params: { providerConfigId: chatOn as AIProviderConfigId },
    },
    configs,
  }).map((c) => c.id);
}

describe("selectImageProviderConfigs", () => {
  it.each([
    {
      chatOn: "claude-account",
      configs: [config("claude-account"), ours],
      expected: [ours.id],
      what: "a Claude chat with only Instrument makes images on Instrument",
    },
    {
      chatOn: "claude-account",
      configs: [config("claude-account"), ours, config("google")],
      expected: ["google", ours.id],
      what: "the person's own key comes before Instrument",
    },
    {
      chatOn: ours.id,
      configs: [ours, config("openrouter")],
      expected: [ours.id, "openrouter"],
      what: "a chat on Instrument makes images there first, its key next",
    },
    {
      chatOn: "grok-account",
      configs: [config("grok-account"), ours, config("openrouter")],
      expected: ["grok-account", "openrouter", ours.id],
      what: "a chat whose own provider makes images starts there",
    },
    {
      chatOn: "grok-account",
      configs: [
        config("grok-account"),
        config("grok-account", "grok-account-2"),
        ours,
      ],
      expected: ["grok-account", ours.id],
      what: "never a second plan of the chat's own kind",
    },
    {
      chatOn: "claude-account",
      configs: [config("claude-account"), config("openrouter"), config("x-ai")],
      expected: ["openrouter", "x-ai"],
      what: "signed out, only the person's own providers",
    },
    {
      chatOn: "claude-account",
      configs: [config("claude-account")],
      expected: [],
      what: "nothing that makes images",
    },
  ])("$what", ({ chatOn, configs, expected }) => {
    expect(order(chatOn, configs)).toEqual(expected);
  });
});
