import type { ModelMessage, ToolResultPart } from "ai";

import { describe, expect, it } from "vitest";

import { SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { TOOLS_FOR_MODEL_OUTPUT } from "../tools/all";
import { budgetStepToolResults } from "./budget-step-tool-results";

/** The documented combined budget for one assistant step's tool results. */
const STEP_TEXT_BUDGET = 32 * 1024;

function resultText(part: ToolResultPart | undefined) {
  if (part?.output.type !== "text" && part?.output.type !== "error-text") {
    throw new TypeError("Expected a text tool result");
  }
  return part.output.value;
}

function step(...parts: ToolResultPart[]): ModelMessage {
  return { content: parts, role: "tool" };
}

function textResult({
  text,
  toolCallId = `call-${text.length}`,
  toolName = "bash",
  type = "text",
}: {
  text: string;
  toolCallId?: string;
  toolName?: string;
  type?: "error-text" | "text";
}): ToolResultPart {
  return {
    output: { type, value: text },
    toolCallId,
    toolName,
    type: "tool-result",
  };
}

function toolParts(messages: ModelMessage[], index = 0) {
  const message = messages[index];
  if (message?.role !== "tool") {
    throw new TypeError(`Expected a tool message at ${index}`);
  }
  return message.content.filter(
    (part): part is ToolResultPart => part.type === "tool-result",
  );
}

describe("budgetStepToolResults", () => {
  it("returns a step inside the budget exactly as it was", () => {
    const message = step(
      textResult({ text: "a".repeat(20_000), toolCallId: "one" }),
      textResult({ text: "b".repeat(12_768), toolCallId: "two" }),
    );

    const result = budgetStepToolResults([message]);

    expect(result.messages[0]).toBe(message);
    expect(result.clipped).toEqual([]);
  });

  it("shares the budget across a step's results", () => {
    const result = budgetStepToolResults([
      step(
        ...Array.from({ length: 5 }, (_, index) =>
          textResult({
            text: `${index}`.repeat(20_000),
            toolCallId: `call-${index}`,
            toolName: "web_search",
          }),
        ),
      ),
    ]);

    expect(result.clipped.map((entry) => entry.retainedCharacters)).toEqual([
      6554, 6554, 6554, 6553, 6553,
    ]);
    expect(
      result.clipped.reduce(
        (total, entry) => total + entry.retainedCharacters,
        0,
      ),
    ).toBe(STEP_TEXT_BUDGET);
    expect(result.clipped[0]).toEqual({
      originalCharacters: 20_000,
      retainedCharacters: 6554,
      stepIndex: 0,
      stepResultCount: 5,
      toolName: "web_search",
    });
  });

  it("keeps short results whole and takes the overage from the long one", () => {
    const result = budgetStepToolResults([
      step(
        textResult({ text: "The whole answer.", toolCallId: "short" }),
        textResult({ text: "L".repeat(100_000), toolCallId: "long" }),
      ),
    ]);

    const [short, long] = toolParts(result.messages);
    expect(resultText(short)).toBe("The whole answer.");
    expect(result.clipped).toHaveLength(1);
    expect(result.clipped[0]?.retainedCharacters).toBe(
      STEP_TEXT_BUDGET - "The whole answer.".length,
    );
    expect(resultText(long)).toContain(
      "Trimmed to fit the combined budget for this step's tool results",
    );
  });

  it("leaves every result in place so the provider still sees a pair per call", () => {
    const message = step(
      textResult({
        text: "x".repeat(50_000),
        toolCallId: "one",
        toolName: "bash",
      }),
      textResult({
        text: "y".repeat(50_000),
        toolCallId: "two",
        toolName: "web_fetch",
      }),
      textResult({
        text: "It failed.",
        toolCallId: "three",
        toolName: "read_file",
        type: "error-text",
      }),
    );

    const result = budgetStepToolResults([message]);
    const parts = toolParts(result.messages);

    expect(parts.map((part) => part.toolCallId)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(parts.map((part) => part.toolName)).toEqual([
      "bash",
      "web_fetch",
      "read_file",
    ]);
    expect(parts[2]?.output.type).toBe("error-text");
    expect(resultText(parts[2])).toBe("It failed.");
  });

  it("keeps the end of a result, where its spill path and boundary are", () => {
    const spillNote = "\nFull output saved to: work/tool-output/abc.log";
    const result = budgetStepToolResults([
      step(
        textResult({
          text: `${"o".repeat(60_000)}${spillNote}`,
          toolCallId: "one",
        }),
        textResult({ text: "p".repeat(60_000), toolCallId: "two" }),
      ),
    ]);

    expect(resultText(toolParts(result.messages)[0])).toContain(spillNote);
  });

  it("does not split a character at either cut", () => {
    const result = budgetStepToolResults([
      step(
        textResult({ text: "😀".repeat(30_000), toolCallId: "one" }),
        textResult({ text: "q".repeat(60_000), toolCallId: "two" }),
      ),
    ]);

    const value = resultText(toolParts(result.messages)[0]);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(value)).toBe(false);
    expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)).toBe(false);
  });

  it("trims the text of a multipart result and leaves its media alone", () => {
    const image = {
      data: "aW1hZ2U=",
      mediaType: "image/png",
      type: "media",
    } as const;
    const result = budgetStepToolResults([
      step(
        {
          output: {
            type: "content",
            value: [{ text: "t".repeat(60_000), type: "text" }, image],
          },
          toolCallId: "one",
          toolName: "read_file",
          type: "tool-result",
        },
        textResult({ text: "u".repeat(60_000), toolCallId: "two" }),
      ),
    ]);

    const part = toolParts(result.messages)[0];
    if (part?.output.type !== "content") {
      throw new TypeError("Expected a content output");
    }
    expect(part.output.value[1]).toEqual(image);
    expect(part.output.value[0]).toMatchObject({ type: "text" });
    expect(result.clipped[0]).toMatchObject({
      originalCharacters: 60_000,
      toolName: "read_file",
    });
  });

  it("budgets each step on its own", () => {
    const withinBudget = step(
      textResult({ text: "z".repeat(100), toolCallId: "a" }),
    );
    const result = budgetStepToolResults([
      withinBudget,
      { content: "Next.", role: "assistant" },
      step(
        textResult({ text: "b".repeat(60_000), toolCallId: "b" }),
        textResult({ text: "c".repeat(60_000), toolCallId: "c" }),
      ),
    ]);

    expect(result.messages[0]).toBe(withinBudget);
    expect(result.clipped.map((entry) => entry.stepIndex)).toEqual([2, 2]);
  });

  it("leaves a result a provider executed for itself alone", () => {
    const message: ModelMessage = {
      content: [
        { text: "Searching.", type: "text" },
        {
          input: { query: "anything" },
          providerExecuted: true,
          toolCallId: "hosted",
          toolName: "web_search",
          type: "tool-call",
        },
        {
          output: { type: "text", value: "h".repeat(100_000) },
          toolCallId: "hosted",
          toolName: "web_search",
          type: "tool-result",
        },
      ],
      role: "assistant",
    };

    expect(budgetStepToolResults([message])).toEqual({
      clipped: [],
      messages: [message],
    });
  });
});

// The audited shape: one assistant step that fired five searches and grew the
// next request by more than 25,000 tokens. Both budgets have to hold for it,
// and the grouping this pass relies on -- one `tool` message per assistant step
// -- is the AI SDK's, not ours, so it is asserted against the real conversion
// rather than a hand-built message.
describe("a step that ran five searches", () => {
  it("stays within the combined budget end to end", async () => {
    const sessionId = StoreId.newSessionId();
    const messageId = StoreId.newMessageId();
    const createdAt = new Date("2026-08-01T00:00:00Z");

    const messages: SessionMessage.WithParts[] = [
      {
        id: messageId,
        metadata: {
          aiGatewayModel: undefined,
          createdAt,
          finishReason: "tool-calls",
          modelId: "gpt-4o",
          providerId: "openai",
          sessionId,
        },
        parts: Array.from({ length: 5 }, (_unused, search) => ({
          callProviderMetadata: undefined,
          input: { query: `search ${search + 1}` },
          metadata: {
            createdAt,
            endedAt: createdAt,
            id: StoreId.newPartId(),
            messageId,
            sessionId,
            toolName: "web_search" as const,
          },
          output: {
            results: {
              costDollars: 0.007,
              kind: "excerpts" as const,
              sources: Array.from({ length: 6 }, (_, source) => ({
                text: `${search}${source}`.repeat(10_000),
                title: `Result ${source + 1}`,
                url: `https://example.com/${search}/${source}`,
              })),
            },
            state: "success" as const,
          },
          providerExecuted: false,
          state: "output-available" as const,
          toolCallId: StoreId.ToolCallSchema.parse(`call_${search}`),
          type: "tool-web_search" as const,
        })),
        role: "assistant",
      },
    ];

    const modelMessages = await SessionMessage.toModelMessages(
      messages,
      TOOLS_FOR_MODEL_OUTPUT,
    );

    const toolMessages = modelMessages.filter(
      (message) => message.role === "tool",
    );
    expect(toolMessages).toHaveLength(1);
    expect(toolParts(toolMessages)).toHaveLength(5);

    // Each search is already down from 120,000 characters to its own 16,000
    // budget, and five of those together still do not fit a request.
    const before = toolParts(toolMessages).reduce(
      (total, part) => total + resultText(part).length,
      0,
    );
    expect(before).toBeGreaterThan(85_000);

    const budgeted = budgetStepToolResults(modelMessages);
    const after = toolParts(
      budgeted.messages.filter((message) => message.role === "tool"),
    ).reduce((total, part) => total + resultText(part).length, 0);

    // The retained text is on budget; the excess is the five notices saying so,
    // which are deliberately not charged against it.
    expect(
      budgeted.clipped.reduce(
        (total, entry) => total + entry.retainedCharacters,
        0,
      ),
    ).toBe(STEP_TEXT_BUDGET);
    expect(after).toBeLessThan(STEP_TEXT_BUDGET + 2000);
  });
});
