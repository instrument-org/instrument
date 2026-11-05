import { BillingNextStepSchema } from "@instrument-org/shared";
import { oc } from "@orpc/contract";
import { z } from "zod";

import { BillingOfferSchema } from "./billing-offer";

const base = oc.errors({
  BAD_REQUEST: {},
  CONFLICT: {},
  FORBIDDEN: {},
  INTERNAL_SERVER_ERROR: {},
  // Every billing procedure but the offer takes ten calls a minute per user.
  TOO_MANY_REQUESTS: {},
  UNAUTHORIZED: {},
});

/**
 * Whether one hosted feature would run now, and if not, the refusal a request
 * for it would get: `subscription-required` with what unlocks it, or
 * `usage-limit-exceeded` with when it comes back, with the `outcome` a client
 * words and the `next` step past it.
 */
const FeatureAvailabilitySchema = z.object({
  available: z.boolean(),
  code: z.string().optional(),
  next: BillingNextStepSchema.optional(),
  outcome: z.string().optional(),
  reason: z.string().optional(),
  resetsAt: z.string().optional(),
});

export type FeatureAvailability = z.output<typeof FeatureAvailabilitySchema>;

/**
 * What the platform says about a user's plan: percent and reset time per
 * enabled window, never dollars. `binding` names the window closest to its
 * limit. `plan` is `free` on the free allowance, the decisions and search
 * every signed-in account gets without a plan or a running trial.
 */
const BillingStatusSchema = z.object({
  /**
   * The account as the app shows it, as the platform decided it. `tier` is
   * `none`, `free`, `trial` or `paid`; `state` is `active` while
   * Instrument's models run, or the outcome a request for them gets
   * (`plan-required`, `limit-reached`, `payment-failed`, ...), with `next`
   * the way past it and `resetsAt` when a spent window comes back.
   * `paymentDue` marks a failed payment the plan still runs through,
   * `planName` the plan paid for, and `upgradeTo` the offered plan above it.
   * Strings rather than enums, so a newer platform's value never fails the
   * read.
   */
  account: z.object({
    next: BillingNextStepSchema.optional(),
    paymentDue: z.boolean().optional(),
    planName: z.string().optional(),
    resetsAt: z.string().optional(),
    state: z.string(),
    tier: z.string(),
    upgradeTo: z.string().optional(),
  }),
  binding: z.string().optional(),
  canSubscribe: z.boolean(),
  /** Which hosted features would run now. */
  features: z.object({
    decisions: FeatureAvailabilitySchema,
    /** Absent from a platform that predates dictation's metering. */
    dictation: FeatureAvailabilitySchema.optional(),
    /** Absent from a platform that predates the free account's images. */
    images: FeatureAvailabilitySchema.optional(),
    models: FeatureAvailabilitySchema,
    search: FeatureAvailabilitySchema.extend({
      /**
       * Whether searches from a model on the person's own provider go
       * through the platform too while search is available. Absent from
       * a platform that predates it, and then taken as false.
       */
      forEveryModel: z.boolean().optional(),
    }),
  }),
  plan: z.string(),
  subscription: z
    .object({
      /** When it ends, if it is scheduled to: the period's end, or later. */
      cancelAt: z.string().optional(),
      cancelAtPeriodEnd: z.boolean(),
      currentPeriodEnd: z.string().optional(),
      /**
       * The plan it pays for, which `plan` above stops naming once a payment
       * fails and the subscription no longer entitles.
       */
      plan: z.string().optional(),
      /**
       * A downgrade waiting for the period's end: the plan it moves to and
       * when. Until then `plan` stays the one paid for now.
       */
      scheduledChange: z
        .object({ at: z.string(), plan: z.string() })
        .optional(),
      status: z.string(),
    })
    .optional(),
  trial: z.object({
    endsAt: z.string().optional(),
    percentUsed: z.number().optional(),
    state: z.enum(["active", "available", "ended"]),
  }),
  /**
   * Each enabled window: `label` heads its meter ("This week") and `period`
   * finishes a sentence ("this week").
   */
  windows: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      percentUsed: z.number(),
      period: z.string(),
      resetsAt: z.string().optional(),
    }),
  ),
});

export const contract = {
  billing: {
    offer: base.input(z.void()).output(BillingOfferSchema),
    status: base.input(z.void()).output(BillingStatusSchema),
  },
  users: {
    getMe: base.input(z.void()).output(
      z.object({
        createdAt: z.date(),
        email: z.string(),
        id: z.string(),
        image: z.string().nullable().optional(),
        name: z.string(),
        updatedAt: z.date(),
      }),
    ),
  },
};
