import type { ModelMessage } from "ai";

import { describe, expect, it } from "vitest";

import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { normalizeToolCallIds } from "./normalize-tool-call-ids";

const anthropicModel = createMockAIGatewayModel({ author: "anthropic" });
const otherModel = createMockAIGatewayModel();

/** Every id an outgoing message carries, keyed by nothing but where it sat. */
function toolCallIds(messages: ModelMessage[]) {
  return messages.flatMap((message) =>
    typeof message.content === "string"
      ? []
      : message.content.flatMap((part) =>
          "toolCallId" in part
            ? [`${message.role}/${part.type}: ${part.toolCallId}`]
            : [],
        ),
  );
}

describe("normalizeToolCallIds", () => {
  it("leaves a non-Anthropic model's ids alone", () => {
    const messages: ModelMessage[] = [
      {
        content: [
          {
            input: {},
            toolCallId: "call/with:special.chars",
            toolName: "bash",
            type: "tool-call",
          },
        ],
        role: "assistant",
      },
    ];

    expect(normalizeToolCallIds({ messages, model: otherModel })).toEqual(
      messages,
    );
  });

  it("rewrites a call and its result to the same id", () => {
    const messages: ModelMessage[] = [
      {
        content: [
          {
            input: { command: "ls" },
            toolCallId: "call/with:special.chars",
            toolName: "bash",
            type: "tool-call",
          },
        ],
        role: "assistant",
      },
      {
        content: [
          {
            output: { type: "text", value: "a-file.txt" },
            toolCallId: "call/with:special.chars",
            toolName: "bash",
            type: "tool-result",
          },
        ],
        role: "tool",
      },
    ];

    expect(
      toolCallIds(normalizeToolCallIds({ messages, model: anthropicModel })),
    ).toMatchInlineSnapshot(`
        [
          "assistant/tool-call: call_with_special_chars",
          "tool/tool-result: call_with_special_chars",
        ]
      `);
  });

  it("rewrites a provider-executed pair sharing one assistant message", () => {
    // What `toModelMessages` produces for a part with `providerExecuted: true`:
    // the result lands beside the call rather than on a tool message, so a pass
    // that only looked at `tool-call` here would leave the two disagreeing.
    const messages: ModelMessage[] = [
      {
        content: [
          {
            input: { query: "weather" },
            toolCallId: "srvtoolu:01/abc",
            toolName: "web_search",
            type: "tool-call",
          },
          {
            output: { type: "text", value: "It is raining." },
            toolCallId: "srvtoolu:01/abc",
            toolName: "web_search",
            type: "tool-result",
          },
        ],
        role: "assistant",
      },
    ];

    const result = normalizeToolCallIds({ messages, model: anthropicModel });

    expect(toolCallIds(result)).toMatchInlineSnapshot(`
      [
        "assistant/tool-call: srvtoolu_01_abc",
        "assistant/tool-result: srvtoolu_01_abc",
      ]
    `);
  });

  it("rewrites an approval request to match the call it approves", () => {
    const messages: ModelMessage[] = [
      {
        content: [
          {
            input: {},
            toolCallId: "call:1",
            toolName: "bash",
            type: "tool-call",
          },
          {
            approvalId: "approval-1",
            toolCallId: "call:1",
            type: "tool-approval-request",
          },
        ],
        role: "assistant",
      },
      {
        content: [
          {
            approvalId: "approval-1",
            approved: true,
            type: "tool-approval-response",
          },
        ],
        role: "tool",
      },
    ];

    const result = normalizeToolCallIds({ messages, model: anthropicModel });

    expect(toolCallIds(result)).toMatchInlineSnapshot(`
      [
        "assistant/tool-call: call_1",
        "assistant/tool-approval-request: call_1",
      ]
    `);
    // The response is keyed by approvalId, which is not ours to touch.
    expect(result.at(-1)).toEqual(messages.at(-1));
  });

  it("leaves ids that already fit the pattern alone", () => {
    const messages: ModelMessage[] = [
      { content: "You are helpful.", role: "system" },
      { content: [{ text: "hi", type: "text" }], role: "user" },
      {
        content: [
          {
            input: {},
            toolCallId: "call_abc-123",
            toolName: "bash",
            type: "tool-call",
          },
        ],
        role: "assistant",
      },
      {
        content: [
          {
            output: { type: "text", value: "ok" },
            toolCallId: "call_abc-123",
            toolName: "bash",
            type: "tool-result",
          },
        ],
        role: "tool",
      },
    ];

    expect(normalizeToolCallIds({ messages, model: anthropicModel })).toEqual(
      messages,
    );
  });
});
