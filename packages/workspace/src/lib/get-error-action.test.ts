import {
  type AIProviderType,
  CLAUDE_ACCOUNT_PROVIDER_CONFIG,
  OUR_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { getErrorAction } from "./get-error-action";

const createMessage = (
  error?: SessionMessage.Assistant["metadata"]["error"],
  provider?: AIProviderType,
): SessionMessage.Assistant => ({
  id: StoreId.newMessageId(),
  metadata: {
    aiGatewayModel: createMockAIGatewayModel({ provider }),
    createdAt: new Date(),
    error,
    finishReason: "stop",
    modelId: "test-model",
    providerId: "test-provider",
    sessionId: StoreId.newSessionId(),
  },
  role: "assistant",
});

type MessageError = NonNullable<SessionMessage.Assistant["metadata"]["error"]>;

const apiCall = (
  fields: Partial<Extract<MessageError, { kind: "api-call" }>> = {},
): MessageError => ({
  kind: "api-call",
  message: "API call failed",
  name: "APIError",
  url: "https://example.com",
  ...fields,
});

const ours = OUR_PROVIDER_CONFIG.type;
const claudeAccount = CLAUDE_ACCOUNT_PROVIDER_CONFIG.type;

describe("getErrorAction", () => {
  it.each<{
    case: string;
    error?: MessageError;
    expected: ReturnType<typeof getErrorAction>;
    provider?: AIProviderType;
    refusedMedia?: string[];
  }>([
    { case: "continues with no error", expected: { type: "continue" } },
    {
      case: "stops on an abort",
      error: { kind: "aborted", message: "Aborted" },
      expected: { type: "stop" },
    },
    {
      case: "stops on a full disk",
      error: { kind: "disk-full", message: "database or disk is full" },
      expected: { type: "stop" },
    },
    {
      case: "stops on a reply that fell into a loop",
      error: { kind: "repetition", message: "Looped" },
      expected: { type: "stop" },
    },
    {
      case: "hands back an unknown error",
      error: { kind: "unknown", message: "Test error" },
      expected: { error: new Error("Test error"), type: "error" },
    },
    {
      case: "hands back a streamed failure it cannot name",
      error: {
        classification: "unknown",
        kind: "unknown",
        message: "Test error",
      },
      expected: { error: new Error("Test error"), type: "error" },
    },
    {
      case: "retries a throttle reported inside a 200 stream",
      error: { classification: "rate-limit", kind: "unknown", message: "429" },
      expected: { type: "retry" },
    },
    {
      case: "retries a transient failure reported inside a 200 stream",
      error: { classification: "transient", kind: "unknown", message: "503" },
      expected: { type: "retry" },
    },
    {
      case: "stops on content the provider refused, rather than resending it",
      error: apiCall({ classification: "unsendable-content", statusCode: 400 }),
      expected: { type: "stop" },
      provider: "openai",
    },
    {
      case: "retries refused content once the media it blames is named",
      error: apiCall({ classification: "unsendable-content", statusCode: 400 }),
      expected: { type: "retry" },
      provider: claudeAccount,
      refusedMedia: ["digest"],
    },
    {
      case: "retries a call to a tool that does not exist",
      error: { kind: "no-such-tool", message: "Tool not found", toolName: "x" },
      expected: { type: "retry" },
    },
    {
      case: "retries invalid tool input",
      error: {
        input: "x",
        kind: "invalid-tool-input",
        message: "Invalid input",
      },
      expected: { type: "retry" },
    },
    {
      case: "waits when too many of the user's requests run at once on our provider",
      error: apiCall({
        classification: "rate-limit",
        responseBody:
          '{"error":{"code":"concurrency-limit","message":"Too many requests are running at once.","retryable":true}}',
        statusCode: 429,
      }),
      expected: { type: "wait" },
      provider: ours,
    },
    {
      case: "retries another provider's concurrency code as a throttle",
      error: apiCall({
        classification: "rate-limit",
        responseBody: '{"error":{"code":"concurrency-limit"}}',
        statusCode: 429,
      }),
      expected: { type: "retry" },
      provider: "openai",
    },
    {
      case: "retries our provider with no response body",
      error: apiCall(),
      expected: { type: "retry" },
      provider: ours,
    },
    {
      case: "retries our provider with a body that is not JSON",
      error: apiCall({ responseBody: "invalid json" }),
      expected: { type: "retry" },
      provider: ours,
    },
    {
      case: "retries our provider when the body does not say retryable",
      error: apiCall({ responseBody: "{}" }),
      expected: { type: "retry" },
      provider: ours,
    },
    {
      case: "stops when our provider says not retryable",
      error: apiCall({
        responseBody: JSON.stringify({
          error: { code: "insufficient-credits", retryable: false },
        }),
      }),
      expected: { type: "stop" },
      provider: ours,
    },
    {
      case: "retries another provider's API error",
      error: apiCall(),
      expected: { type: "retry" },
      provider: "openai",
    },
    ...([429, 502, 529] as const).map((statusCode) => ({
      case: `stops on a Claude account ${statusCode}, which Claude Code already retried`,
      error: apiCall({ classification: "transient", statusCode }),
      expected: { type: "stop" } as const,
      provider: claudeAccount,
    })),
    {
      case: "retries Claude Code itself failing",
      error: apiCall({ classification: "transient", statusCode: 500 }),
      expected: { type: "retry" },
      provider: claudeAccount,
    },
    {
      case: "stops on an error kind it does not know",
      // Not a kind the schema has, which the fallback exists for.
      error: { kind: "other" } as never,
      expected: { type: "stop" },
    },
  ])("$case", ({ error, expected, provider, refusedMedia }) => {
    const message = createMessage(error, provider);
    message.metadata.refusedMedia = refusedMedia;
    expect(getErrorAction(message)).toEqual(expected);
  });
});
