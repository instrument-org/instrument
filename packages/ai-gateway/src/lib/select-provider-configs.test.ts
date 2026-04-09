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

describe("selectProviderConfigs", () => {
  it("prefers exact config by ID over type", () => {
    const configs = [
      createConfig({ id: "openai-1", type: "openai" }),
      createConfig({ id: "openai-2", type: "openai" }),
      createConfig({ id: "google-1", type: "google" }),
    ];

    const result = selectProviderConfigs({
      configs,
      preferredProviderConfig: createConfig({
        id: "openai-2",
        type: "openai",
      }),
      providerTypePriority: [...priority],
    });

    expect(result[0]?.id).toBe("openai-2");
  });

  it("falls back to type when ID not found", () => {
    const configs = [
      createConfig({ id: "openai-1", type: "openai" }),
      createConfig({ id: "google-1", type: "google" }),
      createConfig({
        id: OUR_PROVIDER_CONFIG.id,
        type: OUR_PROVIDER_CONFIG.type,
      }),
    ];

    const result = selectProviderConfigs({
      configs,
      preferredProviderConfig: createConfig({
        id: "google-999",
        type: "google",
      }),
      providerTypePriority: [...priority],
    });

    expect(result[0]?.id).toBe("google-1");
  });

  it("uses priority ordering when preferred not available", () => {
    const configs = [
      createConfig({ id: "openai-1", type: "openai" }),
      createConfig({ id: "google-1", type: "google" }),
    ];

    const result = selectProviderConfigs({
      configs,
      preferredProviderConfig: createConfig({
        id: "quests-999",
        type: OUR_PROVIDER_CONFIG.type,
      }),
      providerTypePriority: [...priority],
    });

    expect(result[0]?.id).toBe("google-1");
  });

  it("prioritizes quests in automatic ordering", () => {
    const configs = [
      createConfig({ id: "fireworks-1", type: "fireworks" }),
      createConfig({ id: "openai-1", type: "openai" }),
      createConfig({
        id: OUR_PROVIDER_CONFIG.id,
        type: OUR_PROVIDER_CONFIG.type,
      }),
    ];

    const result = selectProviderConfigs({
      configs,
      preferredProviderConfig: createConfig({
        id: "vercel-999",
        type: "vercel",
      }),
      providerTypePriority: [...priority],
    });

    expect(result[0]?.id).toBe(OUR_PROVIDER_CONFIG.id);
  });

  it("uses exact ID when multiple configs of same type exist", () => {
    const configs = [
      createConfig({ id: "openrouter-1", type: "openrouter" }),
      createConfig({ id: "openrouter-2", type: "openrouter" }),
    ];

    const result = selectProviderConfigs({
      configs,
      preferredProviderConfig: createConfig({
        id: "openrouter-2",
        type: "openrouter",
      }),
      providerTypePriority: [...priority],
    });

    expect(result[0]?.id).toBe("openrouter-2");
  });

  it("returns up to maxConfigs configs", () => {
    const configs = [
      createConfig({
        id: OUR_PROVIDER_CONFIG.id,
        type: OUR_PROVIDER_CONFIG.type,
      }),
      createConfig({ id: "openrouter-1", type: "openrouter" }),
      createConfig({ id: "google-1", type: "google" }),
    ];

    const result = selectProviderConfigs({
      configs,
      preferredProviderConfig: createConfig({
        id: OUR_PROVIDER_CONFIG.id,
        type: OUR_PROVIDER_CONFIG.type,
      }),
      providerTypePriority: [...priority],
    });

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe(OUR_PROVIDER_CONFIG.id);
    expect(result[1]?.id).toBe("openrouter-1");
  });

  it("returns empty array when no configs match supported types", () => {
    const configs = [
      createConfig({ id: "anthropic-1", type: "anthropic" }),
      createConfig({ id: "deepseek-1", type: "deepseek" }),
    ];

    const result = selectProviderConfigs({
      configs,
      preferredProviderConfig: createConfig({
        id: "anthropic-1",
        type: "anthropic",
      }),
      providerTypePriority: [...priority],
    });

    expect(result).toHaveLength(0);
  });

  it("ignores preferred config type that is not in supported types", () => {
    const configs = [
      createConfig({ id: "anthropic-1", type: "anthropic" }),
      createConfig({ id: "openai-1", type: "openai" }),
    ];

    const result = selectProviderConfigs({
      configs,
      preferredProviderConfig: createConfig({
        id: "anthropic-1",
        type: "anthropic",
      }),
      providerTypePriority: ["openai", OUR_PROVIDER_CONFIG.type],
    });

    expect(result[0]?.id).toBe("openai-1");
  });

  it("does not duplicate the preferred config in fallbacks", () => {
    const configs = [
      createConfig({
        id: OUR_PROVIDER_CONFIG.id,
        type: OUR_PROVIDER_CONFIG.type,
      }),
      createConfig({ id: "openrouter-1", type: "openrouter" }),
    ];

    const result = selectProviderConfigs({
      configs,
      maxConfigs: 3,
      preferredProviderConfig: createConfig({
        id: OUR_PROVIDER_CONFIG.id,
        type: OUR_PROVIDER_CONFIG.type,
      }),
      providerTypePriority: [...priority],
    });

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toMatchInlineSnapshot(`
      [
        "instrument",
        "openrouter-1",
      ]
    `);
  });

  it("respects custom maxConfigs", () => {
    const configs = [
      createConfig({
        id: OUR_PROVIDER_CONFIG.id,
        type: OUR_PROVIDER_CONFIG.type,
      }),
      createConfig({ id: "openrouter-1", type: "openrouter" }),
      createConfig({ id: "google-1", type: "google" }),
    ];

    const result = selectProviderConfigs({
      configs,
      maxConfigs: 1,
      preferredProviderConfig: createConfig({
        id: OUR_PROVIDER_CONFIG.id,
        type: OUR_PROVIDER_CONFIG.type,
      }),
      providerTypePriority: [...priority],
    });

    expect(result).toHaveLength(1);
  });
});
