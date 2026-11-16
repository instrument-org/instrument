import {
  EMPTY_RESPONSE_CODE,
  isExpectedNetworkError,
  type ProviderErrorEvidence,
  type ProviderErrorKind,
  STREAM_ENDED_EARLY_CODE,
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
  ["chatpass_v2_invalid_authorization_context", "auth"], // ChatGPT account
  ["claude_account_image_error", "unsendable-content"], // Claude account, our own
  ["claude_account_prompt_too_long", "context-overflow"], // Claude account, our own
  ["claude_account_usage_limit_exceeded", "usage-limit"], // Claude account, our own
  ["chatpass_v2_scope_not_authorized", "auth"], // ChatGPT account
  ["1261", "context-overflow"], // z.ai: "Prompt too long", "Prompt 超长"
  ["API_KEY_INVALID", "auth"], // Google, a 400 naming it in `error.details[].reason`
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
  // Our gateway's, for a Responses stream that closed before it finished, and
  // a turn's own, for a chat-completions stream that did.
  [STREAM_ENDED_EARLY_CODE, "transient"],
  [EMPTY_RESPONSE_CODE, "transient"], // A turn's own, for a reply with nothing in it
  // The ChatGPT account's usage codes. The limit arrives inside a stream that
  // opened with a 200, so the SDK reports it under a 400 and the code is the
  // only evidence of what it was. Switching the app off in ChatGPT's usage
  // settings answers with the same code as spending the allowance.
  ["subscription_sharing_invalid_user", "auth"],
  ["subscription_sharing_unsupported_capability", "unsendable-content"],
  ["subscription_sharing_usage_limit_exceeded", "usage-limit"],
  ["subscription_sharing_usage_unavailable", "transient"],
  ["subscription_sharing_user_not_eligible", "auth"],
  ["subscription_sharing_user_unavailable", "transient"],
  ["token_revoked", "auth"], // ChatGPT account, disconnected in ChatGPT's settings
  ["unsupported_image_media_type", "unsendable-content"], // OpenAI
]);

/**
 * An allowance the account has spent or is not entitled to, by code. Read
 * ahead of the status, because most of these arrive on a 429, which would
 * otherwise read as throttling that waiting ends. Compared lowercased, since
 * opencode Zen names its own in `error.type` as class names.
 */
const USAGE_LIMIT_CODES = new Set([
  "claude_account_usage_limit_exceeded", // Claude account, our own
  "insufficient_quota", // OpenAI, a spent balance on a 429
  "subscription_sharing_usage_limit_exceeded", // ChatGPT account
  // ChatGPT Business: a cap the workspace admin set, which only they can raise.
  "subscription_sharing_workplace_individual_usage_limit_exceeded",
  "budgetlimiterror", // opencode Zen
  "creditlimitexceeded", // opencode Zen
  "freeusagelimiterror", // opencode Zen
  "gousagelimiterror", // opencode Go
  "1113", // z.ai: "Insufficient balance or no resource package. Please recharge."
  "1308", // z.ai: "Usage limit reached for 5 hours. Your limit will reset at ..."
  "1309", // z.ai: "Your GLM Coding Plan package has expired ..."
  "1310", // z.ai: "Weekly/Monthly Limit Exhausted. Your limit will reset at ..."
  "1311", // z.ai: "Your current subscription plan does not yet include access to glm-5"
  "1314", // z.ai: "Your enterprise package has expired. ..."
]);

/**
 * A spent allowance named only in prose, read on a 429 alone, where it and
 * throttling share the status. Cerebras's `token_quota_exceeded` is its
 * per-minute throttle, which the lookbehind leaves to the status.
 */
const SPENT_ALLOWANCE_PATTERN =
  /insufficient[-_\s]?(?:quota|balance)|(?<!token_)quota[-_\s]?exceeded|budget exceeded|(?<!rate[-_\s]?)limit exhausted|package has expired|plan does not yet include/i;

/**
 * The provider's content rules refusing a request, by code, compared
 * lowercased. Read ahead of the status, since OpenRouter relays one on a 403,
 * which would otherwise read as a refused credential. An image the rules
 * refused is left to its own code (`ONE_FILE_CODES`), since the request
 * recovers by leaving that file out.
 */
const CONTENT_POLICY_CODES = new Set([
  "content_filter", // Azure OpenAI; ours for a reply its filter stopped
  "content_policy_violation", // OpenRouter `error.metadata.error_type`
  "datainspectionfailed", // Alibaba Model Studio
  "moderation_blocked", // OpenAI images
  "refusal", // OpenRouter, a Claude refusal
  "responsibleaipolicyviolation", // Azure OpenAI `error.innererror.code`
]);

/**
 * Content-rule refusals that carry no code of their own: OpenAI puts one under
 * `invalid_prompt`, Anthropic under `invalid_request_error`, and gateways
 * drop OpenAI's `moderation_blocked`.
 */
const CONTENT_POLICY_PATTERN =
  /violating our usage policy|blocked by content filtering policy|rejected (?:as a result of our|by the) safety system/i;

/**
 * A provider's own failure, by code. Read only when no 4xx status says the
 * request itself was refused: a gateway may put `server_error` on a rejection
 * whose real code it did not pass on.
 */
const SERVER_ERROR_CODES = new Set([
  "internal_error",
  "server_error", // OpenAI, in a Responses stream's `response.failed`
  "server_is_overloaded",
  "service_unavailable",
  "slow_down", // Bedrock
]);

/** xAI answers a wrong key with a 400 and a generic code. */
const INVALID_KEY_PATTERN = /incorrect api key provided/i;

/**
 * Our own platform's refusals of a hosted request, by `error.code`. Read ahead
 * of the status because two different answers share a 429: a spent usage
 * window, which waiting a few seconds does not end, and too many requests
 * running at once, which it does. A 402 here is no plan rather than a refused
 * credential, so it stops the turn as a spent allowance rather than reading as
 * a sign-in problem.
 */
const PLATFORM_KIND_BY_CODE = new Map<string, ProviderErrorKind>([
  ["concurrency-limit", "rate-limit"],
  ["meter-unavailable", "transient"],
  ["rate-limit-exceeded", "rate-limit"],
  ["subscription-required", "usage-limit"],
  ["usage-limit-exceeded", "usage-limit"],
]);

/**
 * Content a provider refuses to accept, matched by message.
 *
 * Deliberately short. Each entry is here because a provider was seen producing
 * it, and the example is in the comment so a later reader can tell a real
 * pattern from a guess. Add one when a real failure turns up; this module
 * exists so there is a single place to add it.
 */
const ONE_FILE_PATTERNS = [
  /could not process image/i, // Anthropic: 400 invalid_request_error
  /image exceeds [^.]*maximum/i, // Anthropic: "image exceeds 5 MB maximum"
  // Claude account, as Claude Code rewords Anthropic's refusal of an image or
  // a PDF, under a 400 `invalid_request_error`: "API Error: an image in the
  // conversation could not be processed and was removed. Re-read the file
  // with a different approach if you still need it."
  /an? (?:image|document) in the conversation could not be processed/i,
  /the image data you provided does not represent a valid image/i, // OpenAI
  // Google: 400 INVALID_ARGUMENT "Unable to process input image. Please retry
  // or report in https://developers.generativeai.google/guide/troubleshooting"
  // (google-gemini/gemini-cli#5064, googleapis/python-genai#505)
  /unable to process input image/i,
];

const UNSENDABLE_CONTENT_PATTERNS = [
  ...ONE_FILE_PATTERNS,
  // Limits on the request's media as a whole, which name no one file.
  /image dimensions exceed max allowed size/i, // Anthropic, many-image requests
  /maximum of \d+ pdf pages/i, // Anthropic
];

/**
 * The `unsendable-content` codes that name one file the provider would not
 * take, as against a limit on the account
 * (`subscription_sharing_unsupported_capability`).
 */
const ONE_FILE_CODES = new Set([
  "claude_account_image_error",
  "empty_image_file",
  "failed_to_download_image",
  "image_content_policy_violation",
  "image_file_not_found",
  "image_file_too_large",
  "image_parse_error",
  "image_too_large",
  "image_too_small",
  "invalid_base64_image",
  "invalid_image",
  "invalid_image_format",
  "invalid_image_mode",
  "invalid_image_url",
  "unsupported_image_media_type",
]);

/**
 * A payload larger than the model will take, matched by message.
 *
 * Longer than the list above because every provider words this differently and
 * because compaction depends on catching it. Each pattern names the provider it
 * came from, and every one of those providers is in `AIProviderTypeSchema`.
 */
const CONTEXT_OVERFLOW_PATTERNS = [
  /prompt is too long/i, // Anthropic: "prompt is too long: 213462 tokens > 200000 maximum"
  /prompt (?:too long|exceeds max length|超长)/i, // z.ai, code 1261: "Prompt too long", "Prompt exceeds max length"
  /request_too_large/i, // Anthropic, on a 413
  /exceeds the context window/i, // OpenAI
  /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i, // OpenAI, and proxies speaking its dialect
  /input token count.*exceeds the maximum/i, // Google: "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)"
  /maximum prompt length is \d+/i, // x-ai: "This model's maximum prompt length is 131072 but the request contains 537812 tokens"
  /reduce the length of the messages/i, // Groq
  /maximum context length is \d+ tokens/i, // OpenRouter: "This endpoint's maximum context length is X tokens. However, you requested about Y tokens"
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i, // OpenRouter
  // Together: "The input (516368 tokens) is longer than the model's context
  // length (262144 tokens)." Novita leaves the counts out.
  /input(?: \(\d+ tokens\))? is longer than the model'?s context length/i,
  /requested input length \d+ exceeds maximum input length/i, // DeepInfra: "Requested input length 600010 exceeds maximum input length 131071"
  /exceeds the available context size/i, // llama.cpp, behind Jan and LocalAI
  /`inputs` tokens \+ `max_new_tokens` must be <= \d+/i, // Hugging Face Text Generation Inference
  /too large for the model'?s configured input limit/i, // opencode Go
  /context window exceeded/i, // LiteLLM's own check: "Context Window exceeded for given call."
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
const NOT_CONTEXT_OVERFLOW_PATTERNS = [
  /rate limit/i,
  /too many requests/i,
  // Cohere: "too many tokens: max tokens must be less than or equal to 4096,
  // the maximum output length for this model". The output limit, which a
  // smaller context does not change.
  /max[_ ]tokens must be less than/i,
  // Bedrock's throttle: "Too many tokens, please wait before trying again."
  /too many tokens(?: per day)?, please wait/i,
];

/**
 * xAI's "Requests per Minute (actual/limit): 0/0": an allowance of nothing,
 * which is how an account without a Grok subscription is refused.
 */
export const NO_ALLOWANCE_PATTERN = /\(actual\/limit\):\s*\d+\/0\b/i;

/**
 * Say what a provider's rejection was about.
 *
 * Two of the shapes that arrive are provider verdicts. A failed request reaches
 * the SDK as an `APICallError` carrying a status and a body. A request that
 * succeeded and then failed part-way through the stream reaches us as a bare
 * object, because by then the status was already 200; see `readStreamedError`.
 * Both are reduced to the same evidence and weighed the same way.
 *
 * The third is not a verdict at all. The connection died, so there is no
 * status, no body, and nothing a provider wrote: what arrives is whatever the
 * runtime raises for a socket that closed, most often a bare `TypeError` whose
 * message is the whole of what it knows. It is named here anyway, because the
 * question the caller is asking is what should happen next, and the answer is
 * the one a 5xx gets.
 *
 * `unknown` is a real answer and the common one. It means the caller should do
 * exactly what it did before this module existed.
 */
export function classifyProviderError(
  error: unknown,
): ProviderErrorClassification {
  if (APICallError.isInstance(error)) {
    return weighEvidence(apiCallEvidence(error));
  }

  // Read before the streamed shape below, because a dropped connection can
  // carry a `code` of its own -- `UND_ERR_SOCKET` -- and would otherwise be
  // weighed as though a provider had put that code in a response body.
  if (isExpectedNetworkError(error)) {
    return { evidence: "transport", kind: "transient" };
  }

  // The provider's catalog, read just before the request, left out the model
  // the turn runs on. A ChatGPT plan's catalog has been seen dropping a model
  // and listing it again seconds later, so the next attempt reads it afresh.
  if (isUnlistedModel(error)) {
    return { evidence: "structured", kind: "transient" };
  }

  const streamed = readStreamedError(error);
  if (streamed) {
    return weighEvidence(streamed);
  }

  return { evidence: "none", kind: "unknown" };
}

/**
 * The machine-readable codes a provider error carries, from a response body or
 * a streamed error, for a caller that needs more than the kind: which of the
 * `auth` codes it was, say.
 */
export function providerErrorCodes(error: unknown): string[] {
  if (APICallError.isInstance(error)) {
    return structuredCodes(error.responseBody);
  }
  return readStreamedError(error)?.codes ?? [];
}

/**
 * Whether an `unsendable-content` refusal names one file the provider could
 * not take (an image it could not decode, one over its size cap), rather than
 * a limit on the request's media as a whole or on the account. Only such a
 * refusal is answered by leaving a file out.
 */
export function refusesOneFile(error: unknown) {
  if (classifyProviderError(error).kind !== "unsendable-content") {
    return false;
  }
  const evidence = APICallError.isInstance(error)
    ? apiCallEvidence(error)
    : readStreamedError(error);
  if (evidence === undefined) {
    return false;
  }
  // A code decides ahead of prose, as in `weighEvidence`.
  const code = evidence.codes.find((candidate) => KIND_BY_CODE.has(candidate));
  return code === undefined
    ? ONE_FILE_PATTERNS.some((pattern) => pattern.test(evidence.text))
    : ONE_FILE_CODES.has(code);
}

function apiCallEvidence(error: APICallError) {
  return {
    // The SDK's own verdict, computed from the status: 408, 409, or 5xx. 429
    // is in its set too, but the status check answers that first.
    codes: structuredCodes(error.responseBody),
    isRetryable: error.isRetryable,
    statusCode: error.statusCode,
    // Providers disagree about which of these carries the sentence, and the
    // SDK's message is sometimes the status line alone, so both are searched.
    text: [error.message, error.responseBody].filter(Boolean).join("\n"),
  };
}

/** Whether a `gateway-not-listed-error` is anywhere in the cause chain. */
function isUnlistedModel(error: unknown) {
  let current: unknown = error;
  while (current instanceof Error) {
    if (property(current, "type") === "gateway-not-listed-error") {
      return true;
    }
    current = current.cause;
  }
  return false;
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
  // Own properties only, so a body carrying `constructor` or `toString` reads as
  // absent rather than resolving to something off Object.prototype.
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

/**
 * A rejection a provider reported inside an otherwise successful stream.
 *
 * The request was accepted, so there is no failed HTTP response for the SDK to
 * raise an `APICallError` from: the status was 200 and the headers were sent
 * before anything went wrong. What arrives instead is one chunk carrying an
 * `error` object, which the provider's stream transform re-emits as an `error`
 * part and the caller throws verbatim. It is a bare object, not an `Error`.
 *
 * OpenRouter reports upstream throttling this way, so this is the shape a
 * user hits most often when a shared key is rate-limited:
 *
 * ```json
 * { "code": 429, "message": "... is temporarily rate-limited upstream ...",
 *   "metadata": { "error_type": "rate_limit_exceeded" } }
 * ```
 *
 * `code` is the HTTP status the upstream provider gave, as a number, so it is
 * read as a status rather than as one of the string codes in `KIND_BY_CODE`.
 * Anything without both a message and one machine-readable field is left alone:
 * a plain `Error` from our own code has no business being matched against
 * provider prose.
 */
function readStreamedError(error: unknown) {
  const message = asString(property(error, "message"));
  if (message === undefined) {
    return;
  }

  const code: unknown = property(error, "code");
  const codes = [
    asString(code),
    asString(property(error, "type")),
    asString(property(property(error, "metadata"), "error_type")),
    asString(property(error, "error_type")),
  ].filter((value) => value !== undefined);
  const statusCode = typeof code === "number" ? code : undefined;

  if (codes.length === 0 && statusCode === undefined) {
    return;
  }

  // The upstream status, relayed inside a stream that opened with a 200, read
  // the way the SDK reads a failed response's own: OpenRouter's
  // `{"code": 502, "message": "Provider returned error"}` is a provider's
  // failure that the next attempt may not meet.
  const isRetryable =
    statusCode !== undefined &&
    (statusCode === 408 || statusCode === 409 || statusCode >= 500);

  return { codes, isRetryable, statusCode, text: message };
}

/**
 * Every field a provider might have put a code in, in the order they are worth
 * trusting. OpenAI uses `error.code`, Anthropic uses `error.type`, and the
 * top-level `type` is the last place left to look. Google names its status in
 * `error.status` and the specific reason in `error.details[].reason`; Azure
 * puts its own under `error.innererror.code`, OpenRouter its upstream's
 * under `error.metadata.error_type` or `error.error_type`, and Alibaba Model
 * Studio its own in a top-level `code`.
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
  const details = property(error, "details");
  return [
    asString(property(error, "code")),
    asString(property(error, "type")),
    asString(property(body, "type")),
    asString(property(error, "status")),
    ...(Array.isArray(details)
      ? details.map((detail: unknown) => asString(property(detail, "reason")))
      : []),
    asString(property(property(error, "innererror"), "code")),
    asString(property(property(error, "metadata"), "error_type")),
    asString(property(error, "error_type")),
    asString(property(body, "code")),
  ].filter((value) => value !== undefined);
}

/**
 * Weigh evidence in order of how long it lasts. The status code first, where it
 * is decisive on its own: no provider answers a context overflow with a 429, and
 * none answers throttling with a 401. Then codes meant to be read by programs.
 * Only then the message text, which is a sentence a human wrote and another
 * human may rewrite.
 */
function weighEvidence({
  codes,
  isRetryable,
  statusCode,
  text,
}: {
  codes: string[];
  isRetryable: boolean;
  statusCode: number | undefined;
  text: string;
}): ProviderErrorClassification {
  // 402 is an account that cannot pay for the request rather than one that may
  // not make it, but the session is in the same position either way: nothing it
  // can send will help, and a human has to act before the next turn works. Not
  // `rate-limit`, which promises that waiting is the fix.
  // A spent plan allowance is answered with a 429 when it is refused up
  // front, and throttling is the wrong reading of it: waiting may not end it.
  if (codes.some((code) => USAGE_LIMIT_CODES.has(code.toLowerCase()))) {
    return { evidence: "structured", kind: "usage-limit" };
  }
  if (
    codes.some((code) => CONTENT_POLICY_CODES.has(code.toLowerCase())) &&
    !codes.some((code) => ONE_FILE_CODES.has(code))
  ) {
    return { evidence: "structured", kind: "content-policy" };
  }
  for (const code of codes) {
    const kind = PLATFORM_KIND_BY_CODE.get(code);
    if (kind) {
      return { evidence: "structured", kind };
    }
  }
  if (statusCode === 401 || statusCode === 402 || statusCode === 403) {
    return { evidence: "status", kind: "auth" };
  }
  // xAI answers an account with no subscription behind it with a 429 whose
  // limit is zero requests a minute: no wait ends it, so it is the account
  // that cannot ask, not throttling.
  if (statusCode === 429 && NO_ALLOWANCE_PATTERN.test(text)) {
    return { evidence: "prose", kind: "auth" };
  }
  if (statusCode === 429 && SPENT_ALLOWANCE_PATTERN.test(text)) {
    return { evidence: "prose", kind: "usage-limit" };
  }
  if (statusCode === 429) {
    return { evidence: "status", kind: "rate-limit" };
  }
  if (statusCode === 413) {
    return { evidence: "status", kind: "context-overflow" };
  }

  for (const code of codes) {
    const kind = KIND_BY_CODE.get(code);
    if (kind) {
      return { evidence: "structured", kind };
    }
  }
  if (
    (statusCode === undefined || statusCode >= 500) &&
    codes.some((code) => SERVER_ERROR_CODES.has(code.toLowerCase()))
  ) {
    return { evidence: "structured", kind: "transient" };
  }

  if (statusCode === 400 && INVALID_KEY_PATTERN.test(text)) {
    return { evidence: "prose", kind: "auth" };
  }

  if (CONTENT_POLICY_PATTERN.test(text)) {
    return { evidence: "prose", kind: "content-policy" };
  }

  if (UNSENDABLE_CONTENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return { evidence: "prose", kind: "unsendable-content" };
  }

  if (
    !NOT_CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(text)) &&
    CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(text))
  ) {
    return { evidence: "prose", kind: "context-overflow" };
  }

  if (isRetryable) {
    return { evidence: "status", kind: "transient" };
  }

  return { evidence: "none", kind: "unknown" };
}
