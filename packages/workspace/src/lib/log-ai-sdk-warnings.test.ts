import { afterEach, describe, expect, it, vi } from "vitest";

import { installAISDKWarningLogger } from "./log-ai-sdk-warnings";

describe("installAISDKWarningLogger", () => {
  afterEach(() => {
    globalThis.AI_SDK_LOG_WARNINGS = undefined;
    vi.restoreAllMocks();
  });

  it("logs each kind of warning once, without the part it quotes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installAISDKWarningLogger();
    const logWarnings = globalThis.AI_SDK_LOG_WARNINGS;
    if (!logWarnings) {
      throw new Error("Expected a warning logger");
    }

    const reasoningWarning = (text: string) => ({
      message: `Non-OpenAI reasoning parts are not supported. Skipping reasoning part: ${JSON.stringify({ text, type: "reasoning" })}.`,
      type: "other" as const,
    });
    for (const text of ["first private thought", "second private thought"]) {
      logWarnings({
        model: "instrument/auto",
        provider: "openai.responses",
        warnings: [
          reasoningWarning(text),
          { feature: "topK", type: "unsupported" },
        ],
      });
    }

    expect(warn.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "AI SDK warning (openai.responses / instrument/auto): Non-OpenAI reasoning parts are not supported. Skipping reasoning part",
        ],
        [
          "AI SDK warning (openai.responses / instrument/auto): unsupported topK",
        ],
      ]
    `);
  });
});
