import {
  EMPTY_RESPONSE_MESSAGE,
  STREAM_ENDED_EARLY_MESSAGE,
} from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import { classifyProviderError } from "./classify-provider-error";
import { unfinishedReply } from "./unfinished-reply";

const counted = { inputTokens: 120, outputTokens: 0 };
const uncounted = { inputTokens: undefined, outputTokens: undefined };

describe("unfinishedReply", () => {
  it.each([
    {
      expected: EMPTY_RESPONSE_MESSAGE,
      input: {
        finishReason: "stop",
        repliedWithContent: false,
        usage: counted,
      },
      name: "a stop with nothing in it",
    },
    {
      expected: STREAM_ENDED_EARLY_MESSAGE,
      input: {
        finishReason: "other",
        repliedWithContent: true,
        usage: uncounted,
      },
      name: "a stream that closed before its last chunk",
    },
    {
      expected: undefined,
      input: { finishReason: "stop", repliedWithContent: true, usage: counted },
      name: "a reply that finished",
    },
    {
      expected: undefined,
      input: {
        finishReason: "other",
        repliedWithContent: true,
        usage: counted,
      },
      name: "a provider's own other, which comes with usage",
    },
    {
      expected: undefined,
      input: {
        finishReason: "tool-calls",
        repliedWithContent: true,
        usage: uncounted,
      },
      name: "a finish that named its reason without usage",
    },
  ] as const)("answers $name", ({ expected, input }) => {
    expect(unfinishedReply(input)?.message).toBe(expected);
  });

  it("reads as transient, so the turn retries", () => {
    const error = unfinishedReply({
      finishReason: "stop",
      repliedWithContent: false,
      usage: counted,
    });
    expect(classifyProviderError(error)).toEqual({
      evidence: "structured",
      kind: "transient",
    });
  });
});
