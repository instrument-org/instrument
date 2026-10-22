import { oc } from "@orpc/contract";
import { z } from "zod";

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
 * `usage-limit-exceeded` with when it comes back.
 */
const FeatureAvailabilitySchema = z.object({
  available: z.boolean(),
  code: z.string().optional(),
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
  binding: z.string().optional(),
  canSubscribe: z.boolean(),
  /**
   * Which hosted features would run now. Absent from a platform that
   * predates it, and then each is taken as available.
   */
  features: z
    .object({
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
    })
    .optional(),
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
       * A Stripe trial (`trialing`) or an intro price (`intro`) still
       * running, and when it ends.
       */
      phase: z
        .object({
          endsAt: z.string().optional(),
          key: z.enum(["intro", "trialing"]),
        })
        .optional(),
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
  windows: z.array(
    z.object({
      key: z.string(),
      percentUsed: z.number(),
      resetsAt: z.string().optional(),
    }),
  ),
});

/** The one pricing document every surface renders. */
const BillingOfferSchema = z.object({
  offerVersion: z.string(),
  plans: z.array(
    z.object({
      allowance: z.object({
        multiple: z.number(),
        windows: z.array(
          z.object({
            anchor: z.string(),
            duration: z.string().optional(),
            key: z.string(),
          }),
        ),
      }),
      description: z.string().nullable(),
      features: z.array(z.string()),
      key: z.string(),
      /**
       * What the plan's models are, from its policy, in the order its
       * picker offers them. Absent from an API older than the field.
       */
      models: z
        .array(z.object({ maker: z.string().optional(), name: z.string() }))
        .optional(),
      name: z.string(),
      price: z
        .object({
          currency: z.string(),
          interval: z.string().nullable(),
          unitAmount: z.number().nullable(),
        })
        .nullable(),
    }),
  ),
  trial: z
    .object({
      available: z.boolean().optional(),
      cardRequired: z.boolean(),
      days: z.number(),
      /** A first `months` at `price` through Checkout, in the `intro` mode. */
      intro: z
        .object({
          months: z.number(),
          price: z.object({ currency: z.string(), unitAmount: z.number() }),
        })
        .optional(),
      /**
       * How the trial starts: in the app (`no_card`), or through Checkout
       * with a card (`card`) or at an intro price (`intro`). Absent from an
       * API older than trial modes, which only ran `no_card` and `card`.
       */
      mode: z.enum(["card", "intro", "no_card"]).optional(),
    })
    .nullable(),
  /**
   * Free months of a plan this account can take at Checkout
   * (`createCheckout` with `offer: "beta"`); null for everyone else, and
   * absent from an API older than the offer.
   */
  beta: z
    .object({ months: z.number(), plan: z.string() })
    .nullable()
    .optional(),
});

export const contract = {
  billing: {
    /**
     * Moves a live subscription to another offered plan. An upgrade charges
     * the difference now, and its limits apply once that payment succeeds
     * (`pending` until then). A downgrade is `scheduled` for the period's end
     * (`effectiveAt`), with nothing credited. Choosing the current plan again
     * drops a scheduled downgrade and answers `applied`.
     */
    changePlan: base.input(z.object({ plan: z.string() })).output(
      z.object({
        /** When a `scheduled` change takes effect: the period's end. */
        effectiveAt: z.string().optional(),
        /** Where the change's invoice is paid while it is pending. */
        invoiceUrl: z.string().optional(),
        /**
         * The plan in effect now: the old one while the change is pending or
         * scheduled.
         */
        plan: z.string().nullable(),
        status: z.enum(["applied", "pending", "scheduled"]),
      }),
    ),
    createCheckout: base
      .input(
        z.object({ offer: z.literal("beta").optional(), plan: z.string() }),
      )
      .output(z.object({ url: z.string() })),
    createPortal: base.input(z.void()).output(z.object({ url: z.string() })),
    offer: base.input(z.void()).output(BillingOfferSchema),
    /**
     * Starts the free trial, the only way it starts; a no-op when there is
     * none to start.
     */
    startTrial: base.input(z.void()).output(BillingStatusSchema),
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
