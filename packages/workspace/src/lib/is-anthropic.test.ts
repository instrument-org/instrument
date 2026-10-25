import type { ModelMessage } from "ai";

import { describe, expect, it } from "vitest";

import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { addCacheControlToMessages } from "./add-cache-control";
import { isAnthropic } from "./is-anthropic";

/** Auto as our gateway lists it, resolving to `sourceModelId` right now. */
function auto({
  maker,
  sourceModelId,
}: {
  maker?: string;
  sourceModelId?: string;
}) {
  return {
    ...createMockAIGatewayModel({
      author: "instrument",
      canonicalId: "auto",
      provider: "instrument",
      providerId: "instrument/auto",
    }),
    maker,
    sourceModelId,
  };
}

describe("isAnthropic", () => {
  it.each([
    {
      case: "Auto resolving to Claude",
      expected: true,
      model: auto({ sourceModelId: "anthropic/claude-haiku-5.5" }),
    },
    {
      case: "Auto resolving to another maker's model",
      expected: false,
      model: auto({ sourceModelId: "openai/gpt-6-luna" }),
    },
    {
      case: "Auto resolving elsewhere while its maker still reads anthropic",
      expected: false,
      model: auto({ maker: "anthropic", sourceModelId: "openai/gpt-6-luna" }),
    },
    {
      case: "Auto from a gateway naming only its maker",
      expected: true,
      model: auto({ maker: "anthropic" }),
    },
    {
      case: "Auto from a gateway naming neither",
      expected: false,
      model: auto({}),
    },
    {
      case: "an Anthropic model by author",
      expected: true,
      model: createMockAIGatewayModel({ author: "anthropic" }),
    },
    {
      case: "any other model",
      expected: false,
      model: createMockAIGatewayModel(),
    },
  ])("$case -> $expected", ({ expected, model }) => {
    expect(isAnthropic(model)).toBe(expected);
  });
});

describe("addCacheControlToMessages on Auto resolving to Claude", () => {
  it("marks the system prompt and the last two messages", () => {
    const messages: ModelMessage[] = [
      { content: "system", role: "system" },
      { content: [{ text: "first", type: "text" }], role: "user" },
      { content: [{ text: "reply", type: "text" }], role: "assistant" },
      { content: [{ text: "second", type: "text" }], role: "user" },
    ];

    const marked = addCacheControlToMessages({
      messages,
      model: auto({ sourceModelId: "anthropic/claude-haiku-5.5" }),
    });

    expect(
      marked.map(
        (message) =>
          `${message.role}: ${JSON.stringify(message).includes('"cacheControl"') ? "marked" : "unmarked"}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "system: marked",
        "user: unmarked",
        "assistant: marked",
        "user: marked",
      ]
    `);
  });
});
