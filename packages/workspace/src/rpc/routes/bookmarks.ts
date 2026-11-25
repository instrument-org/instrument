import { z } from "zod";

import { ChangesCardSchema, markCardUndone } from "../../lib/chat/card-undone";
import { base } from "../base";

/**
 * Marks a bookmarks card undone, once the window it was undone in has put
 * the bookmarks back through its own store.
 */
const markUndone = base
  .input(
    z.object({
      card: ChangesCardSchema,
      skipped: z.number(),
      undone: z.number(),
    }),
  )
  .output(z.void())
  .handler(async ({ input: { card, ...outcome } }) => {
    await markCardUndone(card, outcome);
  });

export const bookmarks = { markUndone };
