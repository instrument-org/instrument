import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";

import { isNonRetryableGatewayError } from "./gateway-response-body";

function apiCallError(body: unknown, statusCode = 429) {
  return new APICallError({
    message: "refused",
    requestBodyValues: {},
    responseBody: JSON.stringify(body),
    statusCode,
    url: "http://localhost/ai-gateway/providers/instrument/responses",
  });
}

const refusal = apiCallError({
  error: {
    code: "usage-limit-exceeded",
    message: "Usage limit reached.",
    retryable: false,
  },
});

describe("isNonRetryableGatewayError", () => {
  it.each([
    ["a refusal the gateway marks non-retryable", refusal, true],
    [
      "the same refusal after the SDK's retries ran out",
      new RetryError({
        errors: [refusal, refusal, refusal],
        message: "Failed after 3 attempts.",
        reason: "maxRetriesExceeded",
      }),
      true,
    ],
    [
      "a refusal the gateway says to retry",
      apiCallError({ error: { code: "concurrency-limit", retryable: true } }),
      false,
    ],
    ["a body that isn't the gateway's", apiCallError("<html>", 502), false],
    ["anything else", new Error("boom"), false],
  ])("%s", (_name, error, expected) => {
    expect(isNonRetryableGatewayError(error)).toBe(expected);
  });
});
