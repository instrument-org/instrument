/**
 * Which layer of evidence produced a verdict, most durable first.
 *
 * Worth recording rather than discarding. A provider is free to reword an error
 * message whenever it likes, so a `prose` verdict is a verdict with a shelf
 * life; a shift in the mix from `structured` toward `prose`, or toward `none`,
 * is the signal that the patterns have started to rot.
 */
export type ProviderErrorEvidence = "none" | "prose" | "status" | "structured";

/**
 * What a provider's rejection means for what should happen next.
 *
 * Two of these describe the payload rather than the connection, and those are
 * the two a session can recover from by sending something different:
 * `context-overflow` is too much content, `unsendable-content` is content the
 * provider will not accept at any size. The rest are reported as they are.
 */
export type ProviderErrorKind =
  | "auth"
  | "context-overflow"
  | "rate-limit"
  | "transient"
  | "unknown"
  | "unsendable-content";
