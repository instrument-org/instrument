import { getHistoryStore } from "@/electron-main/browser-view/history-store";
import { z } from "zod";

import { base } from "../base";

const SinceSchema = z.object({
  /** Epoch ms; absent means all time. */
  since: z.number().optional(),
});

/**
 * Removes every visit at or after `since`, the person's and an agent's, and
 * every page left with no visits. `removed` counts the visits.
 */
const clear = base
  .input(SinceSchema)
  .output(z.object({ removed: z.number() }))
  .handler(({ input }) => getHistoryStore().clear(input.since));

/**
 * What clearing from `since` would take, as the person sees it: how many
 * pages they visited visibly in that time, and those pages' hosts,
 * most-visited first.
 */
const summary = base
  .input(SinceSchema)
  .output(z.object({ count: z.number(), hosts: z.array(z.string()) }))
  .handler(({ input }) => getHistoryStore().summary(input.since));

export const history = { clear, summary };
