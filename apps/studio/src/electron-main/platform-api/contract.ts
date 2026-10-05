import { oc } from "@orpc/contract";
import { z } from "zod";

const base = oc.errors({
  BAD_REQUEST: {},
  CONFLICT: {},
  FORBIDDEN: {},
  INTERNAL_SERVER_ERROR: {},
  UNAUTHORIZED: {},
});

/**
 * What the platform says about a user's plan: percent and reset time per
 * enabled window, never dollars. `binding` names the window closest to its
 * limit.
 */
const BillingStatusSchema = z.object({
  binding: z.string().optional(),
  canSubscribe: z.boolean(),
  plan: z.string(),
  subscription: z
    .object({
      /** When it ends, if it is scheduled to: the period's end, or later. */
      cancelAt: z.string().optional(),
      cancelAtPeriodEnd: z.boolean(),
      currentPeriodEnd: z.string().optional(),
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
    })
    .nullable(),
});

export const contract = {
  billing: {
    /**
     * Moves a live subscription to another offered plan, charging the
     * difference now; the new limits apply once that payment succeeds.
     */
    changePlan: base.input(z.object({ plan: z.string() })).output(
      z.object({
        /** Where the change's invoice is paid while it is pending. */
        invoiceUrl: z.string().optional(),
        /** The plan in effect now: the old one while the change is pending. */
        plan: z.string().nullable(),
        status: z.enum(["applied", "pending"]),
      }),
    ),
    createCheckout: base
      .input(z.object({ plan: z.string() }))
      .output(z.object({ url: z.string() })),
    createPortal: base.input(z.void()).output(z.object({ url: z.string() })),
    offer: base.input(z.void()).output(BillingOfferSchema),
    status: base.input(z.void()).output(BillingStatusSchema),
  },
  root: {
    ping: base.input(z.void()).output(z.string()),
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
