import {
  actionLog,
  readActionsNewestFirst,
} from "@instrument-org/workspace/electron";
import { base } from "@/electron-main/rpc/base";
import { z } from "zod";

/**
 * What the person did in the app from `since` to `until`, newest first, a
 * page at a time: the action log and the app's history together. The first page settles `until` (now when absent) and
 * answers it, and each later page passes it back with `next` as its
 * `cursor`, so actions recorded while paging never shift a page. `next` is
 * null on the last page.
 */
const list = base
  .input(
    z.object({
      cursor: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(500).default(100),
      since: z.number(),
      until: z.number().optional(),
    }),
  )
  .handler(async ({ input }) => {
    const until = input.until ?? Date.now();
    const skip = input.cursor ?? 0;
    const { actions, more } = await readActionsNewestFirst({
      limit: input.limit,
      since: input.since,
      skip,
      until,
    });
    return { actions, next: more ? skip + actions.length : null, until };
  });

/** Deletes everything the action log has kept. */
const clear = base.handler(async () => {
  await actionLog().clear();
});

export const actions = { clear, list };
