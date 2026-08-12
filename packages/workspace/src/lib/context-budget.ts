import { type SessionMessage } from "../schemas/session/message";

/**
 * How much of a model's context window a session has spent, and whether that
 * is worth acting on.
 *
 * Every decision here is made against tokens the provider reported, never an
 * estimate. The provider counts the tokenizer we are actually billed by; an
 * estimator introduces a second source of truth that can only ever disagree
 * with it, and it would be disagreeing at the moment the answer matters most.
 */

/**
 * Tokens held back from the transcript for the model's own reply.
 *
 * A window that is full to the last token cannot be replied into, so the
 * budget treats the reserve as spent before the transcript gets any of it.
 */
export const DEFAULT_CONTEXT_RESERVE_TOKENS = 32_000;

/** Fraction of the usable window at which the agent is told it is running out. */
const WARN_AT_FRACTION = 0.85;

/**
 * Most of a window the reserve may ever claim.
 *
 * The reserve is a flat token count because the reply it protects is one, but a
 * flat count is nonsense once the window is smaller than it: subtracting it
 * would leave nothing to measure and quietly turn the feature off. That is not
 * a hypothetical, it is what a shrunken development window looks like, so the
 * case that exists to make this testable would be the one case it refused to
 * measure.
 */
const MAX_RESERVE_FRACTION = 0.2;

export interface ContextBudget {
  /** Tokens the most recent request occupied. */
  occupied: number;
  /** Tokens still available before the reserve is spent. */
  remaining: number;
  status: ContextBudgetStatus;
  /** Window minus the reserve: what the transcript may actually use. */
  usable: number;
}

export type ContextBudgetStatus =
  /** Past the usable window. Nothing more fits without giving something up. */
  | "exhausted"
  /** Room to spare. */
  | "ok"
  /**
   * No context length for this model, so no judgment is possible. Callers must
   * do nothing at all rather than fall back to a default window: guessing low
   * would retire a session that had room left, which is worse than the
   * unbounded growth this feature exists to prevent.
   */
  | "unknown"
  /** Close enough to the limit that the agent should be told while it can act. */
  | "warn";

const UNKNOWN: ContextBudget = {
  occupied: 0,
  remaining: 0,
  status: "unknown",
  usable: 0,
};

export function computeContextBudget({
  contextLength,
  occupied,
  reserveTokens = DEFAULT_CONTEXT_RESERVE_TOKENS,
}: {
  contextLength: number | undefined;
  occupied: number | undefined;
  reserveTokens?: number;
}): ContextBudget {
  if (contextLength === undefined || !Number.isFinite(contextLength)) {
    return UNKNOWN;
  }

  const reserve = Math.min(
    reserveTokens,
    Math.floor(contextLength * MAX_RESERVE_FRACTION),
  );
  const usable = Math.max(0, Math.floor(contextLength - reserve));
  if (usable === 0) {
    // Only reachable for a window of zero or less, which is not a window.
    return UNKNOWN;
  }

  // A session that has not had a reply yet has spent nothing, which is a real
  // answer rather than a missing one.
  const spent = Number.isFinite(occupied) ? Math.max(0, occupied ?? 0) : 0;

  return {
    occupied: spent,
    remaining: Math.max(0, usable - spent),
    status:
      spent >= usable
        ? "exhausted"
        : spent >= usable * WARN_AT_FRACTION
          ? "warn"
          : "ok",
    usable,
  };
}

/**
 * Tokens the last request put in front of the model.
 *
 * This is the newest assistant message's own reported input count, not a total
 * over the session. Every turn resends the transcript, so summing input tokens
 * across turns counts the same prefix once per turn and overstates occupancy by
 * roughly the turn count. `getUsageSummaryFromMessages` does sum that way, and
 * is right to: it answers what the session cost, which is a different question
 * from what is in the window now.
 *
 * `inputTokens` already includes tokens served from cache, so cache reads and
 * writes are not added on top.
 *
 * Assistant messages carrying no usage are skipped rather than treated as an
 * answer, so a turn that failed or is still streaming falls back to the last
 * one the provider actually counted. That number is a turn stale, and stale
 * low, which is the safe direction: it can delay a warning by a turn but
 * cannot invent one.
 */
export function contextOccupancyFromMessages(
  messages: readonly SessionMessage.WithParts[],
): number | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "assistant") {
      continue;
    }

    const inputTokens = message.metadata.usage?.inputTokens;
    if (inputTokens !== undefined && Number.isFinite(inputTokens)) {
      return inputTokens;
    }
  }

  return undefined;
}
