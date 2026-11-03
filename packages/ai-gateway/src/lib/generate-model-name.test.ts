import { describe, expect, it } from "vitest";

import { generateModelName } from "./generate-model-name";

describe("generateModelName", () => {
  it.each([
    ["gpt-4o", "GPT 4o"],
    ["claude-3.5-sonnet", "Claude 3.5 Sonnet"],
    ["deepseek-v3", "DeepSeek V3"],
    ["qwen3-vl-8b-instruct", "Qwen3 VL 8B Instruct"],
    ["gpt-oss:latest", "GPT OSS Latest"],
    ["glm-4.5", "GLM 4.5"],
    ["mistral-7b-instruct-v0.3", "Mistral 7B Instruct V0.3"],
    ["grok-4-1-fast", "Grok 4.1 Fast"],
  ])("names %s %s", (modelId, expected) => {
    expect(generateModelName(modelId)).toBe(expected);
  });
});
