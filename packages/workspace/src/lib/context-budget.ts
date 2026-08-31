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
const DEFAULT_CONTEXT_RESERVE_TOKENS = 32_000;

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
  /** Where `occupied` came from, and so how far it may be acted on. */
  occupancySource: ContextOccupancySource;
  /** Tokens the most recent request occupied. */
  occupied: number;
  /** Tokens still available before the reserve is spent. */
  remaining: number;
  status: ContextBudgetStatus;
  /** Window minus the reserve: what the transcript may actually use. */
  usable: number;
}

/**
 * Tokens a session has spent, and the model that counted them.
 *
 * The model travels with the number because the number means nothing without
 * it. Windows differ between models and tokenizers differ between families, so
 * a count lifted from one turn and held against another model's window is
 * wrong twice over, and wrong by an amount nothing here can measure.
 *
 * The id recorded is the model that was asked for rather than the one the
 * provider served, because the window it is compared against is the asked-for
 * model's. A routing alias names itself on both sides of that comparison, so it
 * matches itself and keeps budgeting rather than switching it off every time
 * routing lands somewhere new.
 */
export interface ContextOccupancy {
  modelId: string;
  tokens: number;
}

type ContextBudgetStatus =
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

type ContextOccupancySource =
  /**
   * Reported by a different model than the one this budget is about, which is
   * what the first turn after a model switch has to work from. Enough to tell
   * the agent its room is running out; not enough to spend its history on.
   */
  | "carried-over"
  /** Reported by the model this budget is about. */
  | "measured"
  /** Nothing reported yet, so nothing has been spent. */
  | "none";

const UNKNOWN: ContextBudget = {
  occupancySource: "none",
  occupied: 0,
  remaining: 0,
  status: "unknown",
  usable: 0,
};

export function computeContextBudget({
  contextLength,
  modelId,
  occupancy,
  reserveTokens = DEFAULT_CONTEXT_RESERVE_TOKENS,
}: {
  contextLength: number | undefined;
  /** The model this budget is about, which is the one about to be asked. */
  modelId: string;
  occupancy: ContextOccupancy | undefined;
  reserveTokens?: number;
}): ContextBudget {
  const usable = usableContextTokens(contextLength, reserveTokens);
  if (usable === undefined) {
    return UNKNOWN;
  }

  const reported =
    occupancy !== undefined && Number.isFinite(occupancy.tokens)
      ? occupancy
      : undefined;

  // A session that has not had a reply yet has spent nothing, which is a real
  // answer rather than a missing one.
  const spent = reported === undefined ? 0 : Math.max(0, reported.tokens);

  return {
    occupancySource:
      reported === undefined
        ? "none"
        : reported.modelId === modelId
          ? "measured"
          : "carried-over",
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
 *
 * The newest count wins even when an older one came from the model now being
 * asked. The older number was measured before everything since it was added, so
 * preferring it would answer a question about the window with a description of
 * a smaller one. The newest count is at least about the history that exists;
 * `computeContextBudget` decides what may be done with it.
 */
export function contextOccupancyFromMessages(
  messages: readonly SessionMessage.WithParts[],
): ContextOccupancy | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "assistant") {
      continue;
    }

    const inputTokens = message.metadata.usage?.inputTokens;
    if (inputTokens !== undefined && Number.isFinite(inputTokens)) {
      return { modelId: message.metadata.modelId, tokens: inputTokens };
    }
  }

  return undefined;
}

/**
 * What the transcript may actually use of a model's window, or nothing at all
 * when there is no window to divide up.
 *
 * Separated from the budget because two decisions need it before there is a
 * budget to read it off: whether a rollover boundary drawn under an earlier
 * window still binds, and what window to record against a new one.
 */
export function usableContextTokens(
  contextLength: number | undefined,
  reserveTokens: number = DEFAULT_CONTEXT_RESERVE_TOKENS,
): number | undefined {
  if (contextLength === undefined || !Number.isFinite(contextLength)) {
    return undefined;
  }

  const reserve = Math.min(
    reserveTokens,
    Math.floor(contextLength * MAX_RESERVE_FRACTION),
  );
  const usable = Math.max(0, Math.floor(contextLength - reserve));

  // Zero is only reachable for a window of zero or less, which is not a window.
  return usable === 0 ? undefined : usable;
}
