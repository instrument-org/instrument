import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { getUsageSummaryFromMessages } from "./usage-summary-compute";

const createdAt = new Date("2024-01-01T10:00:00Z");
const endedAt = new Date("2024-01-01T10:00:02Z");

// Tool output is persisted as-is and only cast on the way back out, so build the
// parts the way the store does -- through `coerce` -- to exercise the shapes a
// build with a different tool schema left behind.
function assistantMessage(outputs: unknown[]): SessionMessage.WithParts {
  const messageId = StoreId.newMessageId();
  const sessionId = StoreId.newSessionId();

  return {
    id: messageId,
    metadata: {
      createdAt,
      finishReason: "stop",
      modelId: "gpt-4o",
      providerId: "openai",
      sessionId,
    },
    parts: outputs.map((output) =>
      SessionMessagePart.coerce({
        metadata: {
          createdAt,
          endedAt,
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        output,
        state: "output-available",
        toolCallId: StoreId.ToolCallSchema.parse("call_123"),
        type: "tool-web_search",
      }),
    ),
    role: "assistant",
  };
}

const tokens = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

describe("getUsageSummaryFromMessages", () => {
  it.each([
    {
      name: "a search a provider model answered",
      output: {
        results: {
          kind: "summary",
          sources: [],
          text: "results",
          usage: tokens,
        },
        state: "success",
      },
    },
    {
      name: "a transcript recorded before results were nested",
      output: { sources: [], state: "success", text: "results", usage: tokens },
    },
  ])("sums the tokens $name reported", ({ output }) => {
    const summary = getUsageSummaryFromMessages([assistantMessage([output])]);

    expect({
      inputTokens: summary.inputTokens,
      msToFinish: summary.msToFinish,
      outputTokens: summary.outputTokens,
      totalTokens: summary.totalTokens,
    }).toMatchInlineSnapshot(`
      {
        "inputTokens": 10,
        "msToFinish": 2000,
        "outputTokens": 5,
        "totalTokens": 15,
      }
    `);
  });

  it.each([
    {
      name: "an output that reports no usage at all",
      output: {
        results: { costDollars: 0.007, kind: "excerpts", sources: [] },
        state: "success",
      },
    },
    {
      name: "counts stored as missing and non-numeric",
      output: {
        sources: [],
        state: "success",
        text: "results",
        usage: { inputTokens: Number.NaN, outputTokens: "5" },
      },
    },
    { name: "an output stored as a bare string", output: "results" },
  ])("counts $name as zero rather than throwing", ({ output }) => {
    const summary = getUsageSummaryFromMessages([assistantMessage([output])]);

    expect({
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      totalTokens: summary.totalTokens,
    }).toMatchInlineSnapshot(`
      {
        "inputTokens": 0,
        "outputTokens": 0,
        "totalTokens": 0,
      }
    `);
  });

  it("merges overlapping steps into one stretch of active time", () => {
    const output = {
      sources: [],
      state: "success",
      text: "results",
      usage: tokens,
    };
    // A subagent step running inside its parent's span: two seconds of active
    // time between them, not four.
    const parent = assistantMessage([output]);
    const child = assistantMessage([output]);
    child.metadata.createdAt = new Date("2024-01-01T10:00:01Z");

    const summary = getUsageSummaryFromMessages([parent, child]);

    expect({
      activeMs: summary.activeMs,
      msToFinish: summary.msToFinish,
    }).toMatchInlineSnapshot(`
      {
        "activeMs": 2000,
        "msToFinish": 4000,
      }
    `);
  });

  it("leaves the gap between two turns out of active time", () => {
    const output = {
      sources: [],
      state: "success",
      text: "results",
      usage: tokens,
    };
    const first = assistantMessage([output]);
    const second = assistantMessage([output]);
    second.metadata.createdAt = new Date("2024-01-01T10:05:00Z");
    const [secondPart] = second.parts;
    if (secondPart) {
      secondPart.metadata = {
        ...secondPart.metadata,
        endedAt: new Date("2024-01-01T10:05:02Z"),
      };
    }

    expect(
      getUsageSummaryFromMessages([first, second]).activeMs,
    ).toMatchInlineSnapshot(`4000`);
  });

  it("counts a tool part with no end timestamp as taking no time", () => {
    const message = assistantMessage([
      { sources: [], state: "success", text: "results", usage: tokens },
    ]);
    const [part] = message.parts;
    if (part) {
      part.metadata = { ...part.metadata, endedAt: undefined };
    }

    expect(getUsageSummaryFromMessages([message]).msToFinish).toBe(0);
  });
});
