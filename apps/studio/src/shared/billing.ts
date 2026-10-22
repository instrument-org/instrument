import { z } from "zod";

/**
 * Subscription states in which the last payment failed and is still owed,
 * the ones the API refuses with `payment-failed`. A Stripe trial that ended
 * without a card pauses, and a card is what resumes it.
 */
export const PAYMENT_FAILED_STATUSES = new Set([
  "incomplete",
  "past_due",
  "paused",
  "unpaid",
]);

/**
 * The body the platform refuses a metered request (search, dictation) with
 * when the account's plan does not cover it: no plan (402
 * `subscription-required`, with `reason`), or a usage window spent until
 * `resetsAt` (429 `usage-limit-exceeded`).
 */
export const PlanRefusalResponseSchema = z.object({
  error: z.object({
    code: z.enum(["subscription-required", "usage-limit-exceeded"]),
    reason: z.string().optional(),
    resetsAt: z.string().optional(),
  }),
});

export type PlanRefusal = z.output<typeof PlanRefusalResponseSchema>["error"];
