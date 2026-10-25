import { z } from "zod";

/**
 * The one way forward the platform offers past a billing outcome. `action`
 * names what a client knows how to do (`start-trial`, `choose-plan`,
 * `upgrade` with `plan`, `update-card`, `contact`); `label` and `page` are
 * the button's words and the website page it opens, for an action this
 * build does not know. Strings rather than enums, so a newer platform's
 * action never fails the read.
 */
export const BillingNextStepSchema = z.object({
  action: z.string(),
  label: z.string(),
  page: z.string().optional(),
  plan: z.string().optional(),
});
export type BillingNextStep = z.output<typeof BillingNextStepSchema>;

/**
 * Our platform turning a hosted request away for the account's plan: no
 * plan for it (402 `subscription-required`, with `reason`), or its usage
 * spent until `resetsAt` (429 `usage-limit-exceeded`). `outcome` is what a
 * client words (`plan-required`, `limit-reached`, ...) and `next` the way
 * past it; both are absent from refusals recorded before the platform sent
 * them.
 */
export const PlanRefusalSchema = z.object({
  code: z.enum(["subscription-required", "usage-limit-exceeded"]),
  next: BillingNextStepSchema.optional(),
  outcome: z.string().optional(),
  reason: z.string().optional(),
  resetsAt: z.string().optional(),
});
export type PlanRefusal = z.output<typeof PlanRefusalSchema>;

/** A refusal's response body. */
export const PlanRefusalBodySchema = z.object({ error: PlanRefusalSchema });
