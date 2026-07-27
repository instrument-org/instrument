import {
  type ProviderErrorEvidence,
  type ProviderErrorKind,
} from "@instrument-org/shared";
import { APICallError } from "ai";

export interface ProviderErrorClassification {
  evidence: ProviderErrorEvidence;
  kind: ProviderErrorKind;
}

/**
 * Machine-readable codes, read from `error.code` or `error.type` in a response
 * body. A code outlives a wording change and a message does not, so these are
 * matched ahead of any prose.
 *
 * The image codes are OpenAI's published `error.code` set. Every one of them
 * means the request cannot be sent as it stands, and no retry of the same bytes
 * will change that.
 */
const KIND_BY_CODE = new Map<string, ProviderErrorKind>([
  ["api_error", "transient"], // Anthropic `error.type`
  ["authentication_error", "auth"], // Anthropic `error.type`
  ["context_length_exceeded", "context-overflow"], // OpenAI
  ["empty_image_file", "unsendable-content"], // OpenAI
  ["failed_to_download_image", "unsendable-content"], // OpenAI
  ["image_content_policy_violation", "unsendable-content"], // OpenAI
  ["image_file_not_found", "unsendable-content"], // OpenAI
  ["image_file_too_large", "unsendable-content"], // OpenAI
  ["image_parse_error", "unsendable-content"], // OpenAI
  ["image_too_large", "unsendable-content"], // OpenAI
  ["image_too_small", "unsendable-content"], // OpenAI
  ["invalid_api_key", "auth"], // OpenAI
  ["invalid_base64_image", "unsendable-content"], // OpenAI
  ["invalid_image", "unsendable-content"], // OpenAI
  ["invalid_image_format", "unsendable-content"], // OpenAI
  ["invalid_image_mode", "unsendable-content"], // OpenAI
  ["invalid_image_url", "unsendable-content"], // OpenAI
  ["model_context_window_exceeded", "context-overflow"], // z.ai
  ["overloaded_error", "transient"], // Anthropic `error.type`
  ["permission_error", "auth"], // Anthropic `error.type`
  ["rate_limit_error", "rate-limit"], // Anthropic `error.type`
  ["rate_limit_exceeded", "rate-limit"], // OpenAI
  ["request_too_large", "context-overflow"], // Anthropic `error.type`, on a 413
  ["unsupported_image_media_type", "unsendable-content"], // OpenAI
]);

/**
 * Content a provider refuses to accept, matched by message.
 *
 * Deliberately short. Each entry is here because a provider was seen producing
 * it, and the example is in the comment so a later reader can tell a real
 * pattern from a guess. Add one when a real failure turns up; this module
 * exists so there is a single place to add it.
 */
const UNSENDABLE_CONTENT_PATTERNS = [
  /could not process image/i, // Anthropic: 400 invalid_request_error
  /image exceeds [^.]*maximum/i, // Anthropic: "image exceeds 5 MB maximum"
  /image dimensions exceed max allowed size/i, // Anthropic, many-image requests
  /maximum of \d+ pdf pages/i, // Anthropic
  /the image data you provided does not represent a valid image/i, // OpenAI
];

/**
 * A payload larger than the model will take, matched by message.
 *
 * Longer than the list above because every provider words this differently and
 * because compaction depends on catching it. Each pattern names the provider it
 * came from, and every one of those providers is in `AIProviderTypeSchema`.
 */
const CONTEXT_OVERFLOW_PATTERNS = [
  /prompt is too long/i, // Anthropic: "prompt is too long: 213462 tokens > 200000 maximum"
  /request_too_large/i, // Anthropic, on a 413
  /exceeds the context window/i, // OpenAI
  /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i, // OpenAI, and proxies speaking its dialect
  /input token count.*exceeds the maximum/i, // Google: "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)"
  /maximum prompt length is \d+/i, // x-ai: "This model's maximum prompt length is 131072 but the request contains 537812 tokens"
  /reduce the length of the messages/i, // Groq
  /maximum context length is \d+ tokens/i, // OpenRouter: "This endpoint's maximum context length is X tokens. However, you requested about Y tokens"
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i, // OpenRouter
  /input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)/i, // Together
  /greater than the context length/i, // LM Studio
  /context window exceeds limit/i, // MiniMax: "invalid params, context window exceeds limit"
  /too large for model with \d+ maximum context length/i, // Mistral
  /prompt too long; exceeded (?:max )?context length/i, // Ollama
  /context[_ ]length[_ ]exceeded/i, // generic
  /token limit exceeded/i, // generic
  /too many tokens/i, // generic
  /^4(?:00|13)\s*(?:status code\s*)?\(no body\)/i, // Cerebras answers with the status and nothing else
];

/**
 * Throttling that happens to talk about tokens, which the generic overflow
 * patterns would otherwise claim. The 429 check covers most of it; this covers
 * a provider that reports throttling under some other status.
 */
const NOT_CONTEXT_OVERFLOW_PATTERNS = [/rate limit/i, /too many requests/i];

/**
 * Say what a provider's rejection was about.
 *
 * Evidence is weighed in order of how long it lasts. The status code first,
 * where it is decisive on its own: no provider answers a context overflow with
 * a 429, and none answers throttling with a 401. Then codes out of the response
 * body, which are meant to be read by programs. Only then the message text,
 * which is a sentence a human wrote and another human may rewrite.
 *
 * `unknown` is a real answer and the common one. It means the caller should do
 * exactly what it did before this module existed.
 */
export function classifyProviderError(
  error: unknown,
): ProviderErrorClassification {
  if (!APICallError.isInstance(error)) {
    return { evidence: "none", kind: "unknown" };
  }

  const { statusCode } = error;
  // 402 is an account that cannot pay for the request rather than one that may
  // not make it, but the session is in the same position either way: nothing it
  // can send will help, and a human has to act before the next turn works. Not
  // `rate-limit`, which promises that waiting is the fix.
  if (statusCode === 401 || statusCode === 402 || statusCode === 403) {
    return { evidence: "status", kind: "auth" };
  }
  if (statusCode === 429) {
    return { evidence: "status", kind: "rate-limit" };
  }
  if (statusCode === 413) {
    return { evidence: "status", kind: "context-overflow" };
  }

  for (const code of structuredCodes(error.responseBody)) {
    const kind = KIND_BY_CODE.get(code);
    if (kind) {
      return { evidence: "structured", kind };
    }
  }

  // Providers disagree about which of these carries the sentence, and the SDK's
  // message is sometimes the status line alone, so both are searched.
  const text = [error.message, error.responseBody].filter(Boolean).join("\n");

  if (UNSENDABLE_CONTENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return { evidence: "prose", kind: "unsendable-content" };
  }

  if (
    !NOT_CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(text)) &&
    CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(text))
  ) {
    return { evidence: "prose", kind: "context-overflow" };
  }

  // The SDK's own verdict, computed from the status: 408, 409, or 5xx. 429 is
  // in its set too, but that was answered above.
  if (error.isRetryable) {
    return { evidence: "status", kind: "transient" };
  }

  return { evidence: "none", kind: "unknown" };
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

/**
 * Read one field off a body no schema describes.
 *
 * Deliberately not validated as a whole. Providers disagree about the shape of
 * this object -- `error` is a string for some of them, `code` is a number for
 * others -- and a schema strict enough to reject those shapes would throw away
 * the sibling fields that did parse.
 */
function property(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return;
  }
  const found: unknown = Reflect.get(value, key);
  return found;
}

/**
 * Every field a provider might have put a code in, in the order they are worth
 * trusting. OpenAI uses `error.code`, Anthropic uses `error.type`, and the
 * top-level `type` is the last place left to look.
 */
function structuredCodes(responseBody: string | undefined) {
  if (!responseBody) {
    return [];
  }

  let body: unknown;
  try {
    body = JSON.parse(responseBody);
  } catch {
    return [];
  }

  const error = property(body, "error");
  return [
    asString(property(error, "code")),
    asString(property(error, "type")),
    asString(property(body, "type")),
  ].filter((value) => value !== undefined);
}
