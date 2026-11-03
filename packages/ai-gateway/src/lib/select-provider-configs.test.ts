import {
  type AIProviderConfigId,
  type AIProviderType,
  OUR_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { selectProviderConfigs } from "./select-provider-configs";

const createConfig = ({
  id,
  type,
}: {
  id: string;
  type: AIProviderType;
}): AIGatewayProviderConfig.Type =>
  ({
    apiKey: "test-key",
    cacheIdentifier: `cache-${id}`,
    id: id as AIProviderConfigId,
    name: `${type} Config`,
    type,
  }) as AIGatewayProviderConfig.Type;

const priority = [
  OUR_PROVIDER_CONFIG.type,
  "openrouter",
  "google",
  "openai",
  "x-ai",
  "vercel",
  "fireworks",
] as const;

const ours = createConfig({
  id: OUR_PROVIDER_CONFIG.id,
  type: OUR_PROVIDER_CONFIG.type,
});

// The ids of the configs picked, in the order they are tried.
const select = (
  configs: AIGatewayProviderConfig.Type[],
  preferred: { id: string; type: AIProviderType },
  providerTypePriority: AIProviderType[] = [...priority],
) =>
  selectProviderConfigs({
    configs,
    preferredProviderConfig: createConfig(preferred),
    providerTypePriority,
  }).map((config) => config.id);

describe("selectProviderConfigs", () => {
  it("prefers the exact config by ID over another of its type", () => {
    const configs = [
      createConfig({ id: "openai-1", type: "openai" }),
      createConfig({ id: "openai-2", type: "openai" }),
      createConfig({ id: "google-1", type: "google" }),
    ];

    expect(select(configs, { id: "openai-2", type: "openai" })).toEqual([
      "openai-2",
      "google-1",
    ]);
  });

  it("falls back to a config of the preferred type when its ID is gone", () => {
    const configs = [
      createConfig({ id: "openai-1", type: "openai" }),
      createConfig({ id: "google-1", type: "google" }),
      ours,
    ];

    expect(select(configs, { id: "google-999", type: "google" })).toEqual([
      "google-1",
      OUR_PROVIDER_CONFIG.id,
    ]);
  });

  it("orders by priority when nothing of the preferred type is there", () => {
    const configs = [
      createConfig({ id: "openai-1", type: "openai" }),
      createConfig({ id: "google-1", type: "google" }),
    ];

    expect(
      select(configs, {
        id: `${OUR_PROVIDER_CONFIG.id}-999`,
        type: OUR_PROVIDER_CONFIG.type,
      }),
    ).toEqual(["google-1", "openai-1"]);
  });

  it("returns the preferred config and one fallback, never the preferred twice", () => {
    const configs = [
      ours,
      createConfig({ id: "openrouter-1", type: "openrouter" }),
      createConfig({ id: "google-1", type: "google" }),
    ];

    expect(select(configs, ours)).toEqual([
      OUR_PROVIDER_CONFIG.id,
      "openrouter-1",
    ]);
  });

  it("returns nothing when no config is of a supported type", () => {
    const configs = [
      createConfig({ id: "anthropic-1", type: "anthropic" }),
      createConfig({ id: "deepseek-1", type: "deepseek" }),
    ];

    expect(select(configs, { id: "anthropic-1", type: "anthropic" })).toEqual(
      [],
    );
  });

  it("skips a preferred config whose type is not supported", () => {
    const configs = [
      createConfig({ id: "anthropic-1", type: "anthropic" }),
      createConfig({ id: "openai-1", type: "openai" }),
    ];

    expect(
      select(configs, { id: "anthropic-1", type: "anthropic" }, [
        "openai",
        OUR_PROVIDER_CONFIG.type,
      ]),
    ).toEqual(["openai-1"]);
  });

  it.each(["chatgpt-account", "grok-account"] as const)(
    "never falls back from one %s to another",
    (type) => {
      const configs = [
        createConfig({ id: "personal", type }),
        createConfig({ id: "work", type }),
        createConfig({ id: "openai-1", type: "openai" }),
      ];

      expect(select(configs, { id: "work", type }, [type, "openai"])).toEqual([
        "work",
        "openai-1",
      ]);
    },
  );
});
