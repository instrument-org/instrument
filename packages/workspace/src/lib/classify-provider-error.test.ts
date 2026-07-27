import { APICallError } from "ai";
import { describe, expect, it } from "vitest";

import {
  classifyProviderError,
  type ProviderErrorClassification,
} from "./classify-provider-error";

function apiCallError({
  message = "",
  responseBody,
  statusCode,
}: {
  message?: string;
  responseBody?: string;
  statusCode?: number;
}) {
  return new APICallError({
    message,
    requestBodyValues: {},
    responseBody,
    statusCode,
    url: "https://example.com/v1/messages",
  });
}

// Every body and message here is one a provider was recorded producing. Adding
// a case means adding the string that provoked it, not a plausible-looking one.
const cases: {
  error: unknown;
  expected: ProviderErrorClassification;
  name: string;
}[] = [
  {
    error: new Error("socket hang up"),
    expected: { evidence: "none", kind: "unknown" },
    name: "an error the SDK did not raise",
  },
  {
    error: apiCallError({ message: "Unauthorized", statusCode: 401 }),
    expected: { evidence: "status", kind: "auth" },
    name: "401",
  },
  {
    error: apiCallError({ message: "Forbidden", statusCode: 403 }),
    expected: { evidence: "status", kind: "auth" },
    name: "403",
  },
  {
    // The status settles this before the generic "too many tokens" overflow
    // pattern can claim it.
    error: apiCallError({
      message: "Too many tokens, please wait before trying again.",
      statusCode: 429,
    }),
    expected: { evidence: "status", kind: "rate-limit" },
    name: "throttling that talks about tokens",
  },
  {
    error: apiCallError({ message: "Payload Too Large", statusCode: 413 }),
    expected: { evidence: "status", kind: "context-overflow" },
    name: "413",
  },
  {
    // Seen running the evals: the account ran dry mid-suite. The body puts the
    // code in as a number, which `structuredCodes` deliberately ignores, so the
    // status is the only thing naming this.
    error: apiCallError({
      message:
        "This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford 3338.",
      responseBody: JSON.stringify({
        error: {
          code: 402,
          message:
            "This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford 3338.",
        },
      }),
      statusCode: 402,
    }),
    expected: { evidence: "status", kind: "auth" },
    name: "OpenRouter out of credits",
  },
  {
    error: apiCallError({
      responseBody: JSON.stringify({
        error: {
          code: "context_length_exceeded",
          message:
            "This model's maximum context length is 128000 tokens. However, your messages resulted in 156789 tokens.",
          param: "messages",
          type: "invalid_request_error",
        },
      }),
      statusCode: 400,
    }),
    expected: { evidence: "structured", kind: "context-overflow" },
    name: "OpenAI context_length_exceeded",
  },
  {
    error: apiCallError({
      responseBody: JSON.stringify({
        error: {
          code: "invalid_image",
          message: "Invalid image.",
          type: "invalid_request_error",
        },
      }),
      statusCode: 400,
    }),
    expected: { evidence: "structured", kind: "unsendable-content" },
    name: "OpenAI invalid_image",
  },
  {
    error: apiCallError({
      responseBody: JSON.stringify({
        error: {
          message: "Rate limit reached for gpt-4o",
          type: "rate_limit_exceeded",
        },
      }),
      statusCode: 400,
    }),
    expected: { evidence: "structured", kind: "rate-limit" },
    name: "a rate limit reported under a 400",
  },
  {
    error: apiCallError({
      responseBody: JSON.stringify({
        error: { message: "Overloaded", type: "overloaded_error" },
        type: "error",
      }),
      statusCode: 529,
    }),
    expected: { evidence: "structured", kind: "transient" },
    name: "Anthropic overloaded_error",
  },
  {
    error: apiCallError({
      message: "Could not process image",
      responseBody: JSON.stringify({
        error: {
          message: "Could not process image",
          type: "invalid_request_error",
        },
        type: "error",
      }),
      statusCode: 400,
    }),
    expected: { evidence: "prose", kind: "unsendable-content" },
    name: "Anthropic undecodable image",
  },
  {
    error: apiCallError({
      message:
        "messages.0.content.1.image.source.base64.data: image exceeds 5 MB maximum: 6291456 bytes > 5242880 bytes",
      statusCode: 400,
    }),
    expected: { evidence: "prose", kind: "unsendable-content" },
    name: "Anthropic oversized image",
  },
  {
    error: apiCallError({
      message:
        "messages.0.content.0.document: The document exceeds the maximum of 100 PDF pages",
      statusCode: 400,
    }),
    expected: { evidence: "prose", kind: "unsendable-content" },
    name: "Anthropic over-long PDF",
  },
  {
    error: apiCallError({
      message:
        "The image data you provided does not represent a valid image format",
      statusCode: 400,
    }),
    expected: { evidence: "prose", kind: "unsendable-content" },
    name: "OpenAI undecodable image",
  },
  {
    error: apiCallError({
      message: "prompt is too long: 213462 tokens > 200000 maximum",
      statusCode: 400,
    }),
    expected: { evidence: "prose", kind: "context-overflow" },
    name: "Anthropic overflow",
  },
  {
    error: apiCallError({
      message:
        "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)",
      statusCode: 400,
    }),
    expected: { evidence: "prose", kind: "context-overflow" },
    name: "Google overflow",
  },
  {
    error: apiCallError({
      message:
        "This model's maximum prompt length is 131072 but the request contains 537812 tokens",
      statusCode: 400,
    }),
    expected: { evidence: "prose", kind: "context-overflow" },
    name: "x-ai overflow",
  },
  {
    error: apiCallError({
      message:
        "Please reduce the length of the messages or completion, and try again.",
      statusCode: 400,
    }),
    expected: { evidence: "prose", kind: "context-overflow" },
    name: "Groq overflow",
  },
  {
    // `code` is a number here, which must not cost us the message alongside it.
    error: apiCallError({
      responseBody: JSON.stringify({
        error: {
          code: 400,
          message:
            "This endpoint's maximum context length is 128000 tokens. However, you requested about 190000 tokens.",
        },
      }),
      statusCode: 400,
    }),
    expected: { evidence: "prose", kind: "context-overflow" },
    name: "OpenRouter overflow, with a numeric code",
  },
  {
    error: apiCallError({
      message:
        "The input (265330 tokens) is longer than the model's context length (262144 tokens).",
      statusCode: 400,
    }),
    expected: { evidence: "prose", kind: "context-overflow" },
    name: "Together overflow",
  },
  {
    error: apiCallError({ message: "400 status code (no body)" }),
    expected: { evidence: "prose", kind: "context-overflow" },
    name: "Cerebras overflow, reported as a bare status",
  },
  {
    error: apiCallError({ message: "Internal server error", statusCode: 500 }),
    expected: { evidence: "status", kind: "transient" },
    name: "500",
  },
  {
    error: apiCallError({ message: "Request Timeout", statusCode: 408 }),
    expected: { evidence: "status", kind: "transient" },
    name: "408",
  },
  {
    error: apiCallError({
      message: "Model `gpt-9` does not exist",
      responseBody: JSON.stringify({
        error: {
          code: "model_not_found",
          message: "Model `gpt-9` does not exist",
        },
      }),
      statusCode: 404,
    }),
    expected: { evidence: "none", kind: "unknown" },
    name: "a rejection this module has no opinion about",
  },
  {
    error: apiCallError({
      message: "Bad Request",
      responseBody: "<html><body>502 Bad Gateway</body></html>",
      statusCode: 400,
    }),
    expected: { evidence: "none", kind: "unknown" },
    name: "a body that is not JSON",
  },
];

describe("classifyProviderError", () => {
  it.each(cases)("classifies $name", ({ error, expected }) => {
    expect(classifyProviderError(error)).toEqual(expected);
  });
});
