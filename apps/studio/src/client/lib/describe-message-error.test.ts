import { type SessionMessage } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { describeMessageError } from "./describe-message-error";

type MessageError = NonNullable<SessionMessage.Assistant["metadata"]["error"]>;

// The text a provider sent, which is what must never reach the transcript.
const UPSTREAM_THROTTLE_TEXT =
  '{"code":429,"message":"openai/gpt-5.6-luna is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations","metadata":{"error_type":"rate_limit_exceeded"}}';

const cases: Record<string, MessageError> = {
  "a missing API key": { kind: "api-key", message: "No API key found" },
  "a payload over the context window": {
    classification: "context-overflow",
    kind: "api-call",
    message: "prompt is too long: 213462 tokens > 200000 maximum",
    name: "AI_APICallError",
    statusCode: 400,
    url: "https://example.com/gateway/openrouter/v1/chat/completions",
  },
  "a rejection nothing could name": {
    classification: "unknown",
    kind: "unknown",
    message: "boom",
  },
  "a throttle reported inside a 200 stream": {
    classification: "rate-limit",
    kind: "unknown",
    message: UPSTREAM_THROTTLE_TEXT,
  },
  "a turn the user stopped": { kind: "aborted", message: "Aborted" },
  "content the provider refused": {
    classification: "unsendable-content",
    kind: "api-call",
    message: "Could not process image",
    name: "AI_APICallError",
    statusCode: 400,
    url: "https://example.com/gateway/openrouter/v1/chat/completions",
  },
};

describe("describeMessageError", () => {
  it("says what the user is looking at, in our words", () => {
    const described = Object.fromEntries(
      Object.entries(cases).map(([name, error]) => [
        name,
        describeMessageError(error),
      ]),
    );
    expect(described).toMatchInlineSnapshot(`
      {
        "a missing API key": {
          "detail": "No usable API key was found for this model. Check the model's provider settings.",
          "summary": "No API key",
        },
        "a payload over the context window": {
          "detail": "This conversation is longer than the model will accept. Starting a new task carries none of it over.",
          "summary": "Conversation too long",
        },
        "a rejection nothing could name": {
          "detail": "Try again, or start a new task.",
          "summary": "Something went wrong",
        },
        "a throttle reported inside a 200 stream": {
          "detail": "The model is busy right now. Trying again in a moment usually clears it.",
          "summary": "Model is busy",
        },
        "a turn the user stopped": {
          "detail": "This turn was stopped.",
          "summary": "Stopped",
        },
        "content the provider refused": {
          "detail": "The model would not accept something in this conversation, such as an attached file. Starting a new task leaves it behind.",
          "summary": "Content the model refused",
        },
      }
    `);
  });

  it("repeats nothing the provider wrote", () => {
    const { detail, summary } = describeMessageError({
      classification: "rate-limit",
      kind: "unknown",
      message: UPSTREAM_THROTTLE_TEXT,
    });

    for (const leak of ["openrouter", "gpt-5.6-luna", "http", "your own key"]) {
      expect(`${summary} ${detail}`.toLowerCase()).not.toContain(leak);
    }
  });

  it("describes a classified rejection by what it was, not how it arrived", () => {
    // Same condition, one shape per whether the provider had already sent its
    // response headers. The user is in the same position either way.
    const streamed = describeMessageError({
      classification: "rate-limit",
      kind: "unknown",
      message: UPSTREAM_THROTTLE_TEXT,
    });
    const failed = describeMessageError({
      classification: "rate-limit",
      kind: "api-call",
      message: "Too many requests",
      name: "AI_APICallError",
      statusCode: 429,
      url: "https://example.com/gateway",
    });

    expect(streamed).toEqual(failed);
  });
});
