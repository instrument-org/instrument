import { APICallError } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkAccountWithRequest,
  readAccountCheckFailure,
} from "./check-account";

const generateText = vi.hoisted(() => vi.fn());

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText,
}));
vi.mock("@instrument-org/ai-gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@instrument-org/ai-gateway")>()),
  fetchAISDKModel: () => Promise.resolve({ ok: true, value: {} }),
}));
vi.mock("../logic/server/url", () => ({
  getWorkspaceServerURL: () => "http://localhost:1",
}));

function refusal(
  statusCode: number,
  error: {
    code?: string;
    message?: string;
    resets_at?: number | string;
    resets_in_seconds?: number;
    type?: string;
  },
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

afterEach(() => {
  vi.useRealTimers();
});

describe("readAccountCheckFailure", () => {
  it.each([
    {
      error: refusal(400, { code: "subscription_sharing_user_not_eligible" }),
      expected: { state: "not-eligible" },
      label: "a ChatGPT plan that can't be shared",
    },
    {
      error: refusal(403, { code: "chatpass_v2_scope_not_authorized" }),
      expected: { state: "not-eligible" },
      label: "a ChatGPT sign-in that left plan access out",
    },
    {
      error: refusal(401, { code: "subscription_sharing_invalid_user" }),
      expected: { state: "not-eligible" },
      label: "a ChatGPT user the plan doesn't cover",
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
        resets_at: 1_791_489_600,
        type: "claude_account_usage_limit_exceeded",
      }),
      expected: {
        resetsAt: "2026-10-08T20:00:00.000Z",
        state: "out-of-usage",
      },
      label: "a Claude plan out of usage, with its reset in seconds",
    },
    {
      error: refusal(429, {
        resets_at: "2026-10-08T20:00:00Z",
        type: "claude_account_usage_limit_exceeded",
      }),
      expected: { resetsAt: "2026-10-08T20:00:00Z", state: "out-of-usage" },
      label: "a usage refusal with its reset as a time",
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
    {
      error: new TypeError("fetch failed"),
      expected: { message: "fetch failed", state: "unknown" },
      label: "a dropped connection",
    },
  ])("reads $label", ({ error, expected }) => {
    expect(readAccountCheckFailure(error)).toEqual(expected);
  });

  it("reads ChatGPT's reset given in seconds from now", () => {
    vi.useFakeTimers({ now: new Date("2026-10-08T19:00:00Z") });
    expect(
      readAccountCheckFailure(
        refusal(429, {
          code: "subscription_sharing_usage_limit_exceeded",
          resets_in_seconds: 3600,
        }),
      ),
    ).toEqual({ resetsAt: "2026-10-08T20:00:00.000Z", state: "out-of-usage" });
  });
});

describe("checkAccountWithRequest", () => {
  const workspaceConfig = {
    captureException: vi.fn(),
    getAIProviderConfigs: () => [],
    modelCache: { get: vi.fn(), set: vi.fn() },
  } as unknown as Parameters<
    typeof checkAccountWithRequest
  >[0]["workspaceConfig"];
  const modelURI = "ours/test" as Parameters<
    typeof checkAccountWithRequest
  >[0]["modelURI"];

  it("answers ready for any reply", async () => {
    generateText.mockResolvedValue({ text: "OK" });
    await expect(
      checkAccountWithRequest({ modelURI, workspaceConfig }),
    ).resolves.toEqual({ state: "ready" });
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0 }),
    );
  });

  it("hands its signal to the request and rejects with its reason", async () => {
    generateText.mockImplementation(
      ({ abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise((_, reject) => {
          abortSignal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    const controller = new AbortController();
    const check = checkAccountWithRequest({
      modelURI,
      signal: controller.signal,
      workspaceConfig,
    });
    await vi.waitFor(() => {
      expect(generateText).toHaveBeenCalled();
    });
    controller.abort(new Error("deadline"));
    await expect(check).rejects.toThrow("deadline");
  });
});
