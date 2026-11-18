import {
  createHostedLimiter,
  DEFAULT_HOSTED_LIMITS,
  type HostedLimits,
} from "@instrument-org/ai-gateway";

/**
 * The one limiter every hosted request from this app goes through (the model
 * proxy's, search's and dictation's), so together they stay under what the
 * platform admits for the account at once and a minute.
 */
export const hostedLimiter = createHostedLimiter();

/**
 * Takes the limits the billing status names, or the defaults from a platform
 * that names none.
 */
export function recordHostedLimits(limits: HostedLimits | undefined) {
  hostedLimiter.setLimits(limits ?? DEFAULT_HOSTED_LIMITS);
}
