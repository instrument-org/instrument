import { z } from "zod";

/**
 * Which layer of evidence produced a verdict, most durable first.
 *
 * Worth recording rather than discarding. A provider is free to reword an error
 * message whenever it likes, so a `prose` verdict is a verdict with a shelf
 * life; a shift in the mix from `structured` toward `prose`, or toward `none`,
 * is the signal that the patterns have started to rot.
 *
 * `transport` is the one that cannot rot, because no provider wrote it: it is
 * the shape the runtime raised when the connection failed, and the request
 * carrying it never reached anything that could have answered.
 */
export const ProviderErrorEvidenceSchema = z.enum([
  "none",
  "prose",
  "status",
  "structured",
  "transport",
]);
export type ProviderErrorEvidence = z.output<
  typeof ProviderErrorEvidenceSchema
>;

/**
 * What a provider's rejection means for what should happen next.
 *
 * Two of these describe the payload rather than the connection, and those are
 * the two a session can recover from by sending something different:
 * `context-overflow` is too much content, `unsendable-content` is content the
 * provider will not accept at any size. `rate-limit` and `transient` are the
 * two that waiting alone resolves, so they are the two worth retrying.
 * `usage-limit` is an allowance the user spent or switched off on a plan of
 * their own, which waiting may or may not end and only they can raise.
 * `content-policy` is the provider's content rules refusing the request or
 * stopping the reply, which the same request meets again.
 */
export const ProviderErrorKindSchema = z.enum([
  "auth",
  "content-policy",
  "context-overflow",
  "rate-limit",
  "transient",
  "unknown",
  "unsendable-content",
  "usage-limit",
]);
export type ProviderErrorKind = z.output<typeof ProviderErrorKindSchema>;

/**
 * A Responses API stream that closed without a terminal event
 * (`response.completed`, `response.incomplete`, `response.failed` or `error`).
 * The gateway's proxy turns that into an `error` event carrying this code and
 * message, so the SDK reports a failure rather than a finish with no reason.
 * The message is how a stored error is recognized again, since a stream error
 * keeps only its message on the session.
 */
export const STREAM_ENDED_EARLY_CODE = "stream_ended_early";
export const STREAM_ENDED_EARLY_MESSAGE =
  "The model's reply stopped before it finished.";

/**
 * A reply the provider's content filter stopped (a `content-filter` finish),
 * failed with the code Azure gives the same refusal up front. The message is
 * how a stored error is recognized again.
 */
export const CONTENT_FILTERED_CODE = "content_filter";
export const CONTENT_FILTERED_MESSAGE =
  "The provider's content filter stopped the model's reply.";

/**
 * A reply that finished normally with nothing in it: no text, no reasoning,
 * no tool call. A provider's degenerate answer that the next attempt usually
 * does not repeat, so it reads as transient. The message is how a stored
 * error is recognized again.
 */
export const EMPTY_RESPONSE_CODE = "empty_response";
export const EMPTY_RESPONSE_MESSAGE = "The model's reply was empty.";
