import { APICallError } from "ai";
import { describe, expect, it } from "vitest";

import { readAccountCheckFailure } from "./check-account";

function refusal(
  statusCode: number,
  error: { code?: string; message?: string; resets_at?: string; type?: string },
) {
  return new APICallError({
    isRetryable: false,
    message: error.message ?? "refused",
    requestBodyValues: {},
    responseBody: JSON.stringify({ error }),
    statusCode,
    url: "http://localhost/ai-gateway/providers/chatgpt-account/responses",
  });
}

describe("readAccountCheckFailure", () => {
  it.each([
    {
      error: refusal(400, { code: "subscription_sharing_user_not_eligible" }),
      expected: { state: "not-eligible" },
      label: "a ChatGPT plan that can't be shared",
    },
    {
      error: refusal(401, { code: "token_revoked" }),
      expected: { state: "signed-out" },
      label: "a ChatGPT session ended in ChatGPT's settings",
    },
    {
      error: refusal(400, {
        code: "subscription_sharing_usage_limit_exceeded",
      }),
      expected: { resetsAt: undefined, state: "out-of-usage" },
      label: "a ChatGPT plan out of usage",
    },
    {
      error: refusal(429, {
        resets_at: "2026-10-08T20:00:00Z",
        type: "claude_account_usage_limit_exceeded",
      }),
      expected: {
        resetsAt: "2026-10-08T20:00:00Z",
        state: "out-of-usage",
      },
      label: "a Claude plan out of usage, with its reset",
    },
    {
      error: refusal(401, { type: "authentication_error" }),
      expected: { state: "signed-out" },
      label: "a Claude sign-in that was refused",
    },
    {
      error: refusal(500, { message: "upstream broke", type: "api_error" }),
      expected: { message: "upstream broke", state: "unknown" },
      label: "a provider outage",
    },
  ])("reads $label", ({ error, expected }) => {
    expect(readAccountCheckFailure(error)).toEqual(expected);
  });
});
