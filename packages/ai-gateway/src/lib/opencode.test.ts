import { describe, expect, it } from "vitest";

import { openCodeAuthor, openCodeEndpoint } from "./opencode";

// The SDK package OpenCode's own client uses per model, as published on
// models.dev for its `opencode-go` and `opencode-zen` providers, so a change
// here is checked against what OpenCode serves rather than against itself.
describe("openCodeEndpoint", () => {
  it.each([
    ["opencode-go", "glm-5.3", "chat"],
    ["opencode-go", "kimi-k3", "chat"],
    ["opencode-go", "deepseek-v4-pro", "chat"],
    ["opencode-go", "qwen3.7-max", "chat"],
    ["opencode-go", "qwen3.8-max", "messages"],
    ["opencode-go", "minimax-m3", "messages"],
    ["opencode-go", "gpt-6-luna", "responses"],
    ["opencode-go", "grok-4.7", "responses"],
    ["opencode-go", "muse-spark-1.3-contributor", "responses"],
    ["opencode-zen", "claude-sonnet-5-5", "messages"],
    ["opencode-zen", "qwen3.6-plus", "messages"],
    ["opencode-zen", "qwen3.8-max", "chat"],
    ["opencode-zen", "minimax-m3", "chat"],
    ["opencode-zen", "minimax-m3-free", "messages"],
    ["opencode-zen", "gemini-3.7-flash", "google"],
    ["opencode-zen", "gpt-6.1-sol", "responses"],
    ["opencode-zen", "grok-code", "chat"],
    ["opencode-zen", "big-pickle", "chat"],
  ] as const)("%s answers %s on %s", (type, modelId, expected) => {
    expect(openCodeEndpoint(type, modelId)).toBe(expected);
  });
});

describe("openCodeAuthor", () => {
  it.each([
    ["claude-opus-5-5", "anthropic"],
    ["glm-5.3", "z-ai"],
    ["kimi-k3", "moonshotai"],
    ["qwen3.8-max", "qwen"],
    ["big-pickle", "opencode"],
  ])("reads %s as %s", (modelId, expected) => {
    expect(openCodeAuthor(modelId)).toBe(expected);
  });
});
