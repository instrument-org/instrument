import { z } from "zod";

/** The one pricing document every surface renders. */
export const BillingOfferSchema = z.object({
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
  /**
   * The trial on offer, started on the website: how long it runs, and
   * whether it asks for a card.
   */
  trial: z
    .object({
      available: z.boolean().optional(),
      cardRequired: z.boolean(),
      days: z.number(),
    })
    .nullable(),
  /**
   * Free months of a plan this account can claim as a trial on the
   * website; null for everyone else, and absent from an API older than the
   * offer.
   */
  beta: z
    .object({ months: z.number(), plan: z.string() })
    .nullable()
    .optional(),
});

export type BillingOffer = z.output<typeof BillingOfferSchema>;
