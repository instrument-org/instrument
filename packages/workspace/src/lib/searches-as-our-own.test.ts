import { describe, expect, it } from "vitest";

import { SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { TOOLS_FOR_MODEL_OUTPUT } from "../tools/all";
import { searchesAsOurOwn } from "./searches-as-our-own";

const createdAt = new Date("2026-11-06T10:00:00Z");

/** A reply holding one search Claude Code ran, as a Claude account step records it. */
function replyWithSearch(): SessionMessage.WithParts[] {
  const sessionId = StoreId.newSessionId();
  const messageId = StoreId.newMessageId();
  const partMetadata = {
    createdAt,
    id: StoreId.newPartId(),
    messageId,
    sessionId,
  };
  return [
    {
      id: StoreId.newMessageId(),
      metadata: { createdAt, sessionId },
      parts: [
        {
          metadata: { ...partMetadata, id: StoreId.newPartId() },
          text: "Figma news?",
          type: "text",
        },
      ],
      role: "user",
    },
    {
      id: messageId,
      metadata: {
        aiGatewayModel: undefined,
        createdAt,
        finishReason: "stop",
        modelId: "claude-opus-5-5",
        providerId: "claude-account",
        sessionId,
      },
      parts: [
        {
          input: { query: "figma news" },
          metadata: { ...partMetadata, endedAt: createdAt },
          output: {
            results: {
              kind: "summary",
              sources: [{ title: "Figma Q3", url: "https://figma.com/q3" }],
              text: "Figma reported Q3 earnings.",
            },
            state: "success",
          },
          providerExecuted: true,
          state: "output-available",
          toolCallId: StoreId.ToolCallSchema.parse("toolu_search"),
          type: "tool-web_search",
        },
        {
          metadata: { ...partMetadata, id: StoreId.newPartId() },
          state: "done",
          text: "Figma reported earnings.",
          type: "text",
        },
      ],
      role: "assistant",
    },
  ];
}

/** Each message's role and its parts' kinds, which is what decides who reads it. */
async function shapeFor(provider: "claude-account" | "openrouter") {
  const messages = await SessionMessage.toModelMessages(
    searchesAsOurOwn(replyWithSearch(), createMockAIGatewayModel({ provider })),
    TOOLS_FOR_MODEL_OUTPUT,
  );
  return messages.map((message) => ({
    parts:
      typeof message.content === "string"
        ? ["text"]
        : message.content.map((part) =>
            part.type === "tool-call" || part.type === "tool-result"
              ? `${part.type}${"providerExecuted" in part && part.providerExecuted ? " (provider)" : ""}`
              : part.type,
          ),
    role: message.role,
  }));
}

describe("searchesAsOurOwn", () => {
  it("keeps a Claude account's search with its result in the reply, where its replay reads it", async () => {
    expect(await shapeFor("claude-account")).toMatchInlineSnapshot(`
      [
        {
          "parts": [
            "text",
          ],
          "role": "user",
        },
        {
          "parts": [
            "tool-call (provider)",
            "tool-result",
            "text",
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  it("sends another model the search as a call of ours answered by a tool message", async () => {
    expect(await shapeFor("openrouter")).toMatchInlineSnapshot(`
      [
        {
          "parts": [
            "text",
          ],
          "role": "user",
        },
        {
          "parts": [
            "tool-call",
            "text",
          ],
          "role": "assistant",
        },
        {
          "parts": [
            "tool-result",
          ],
          "role": "tool",
        },
      ]
    `);
  });
});
