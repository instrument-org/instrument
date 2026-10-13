import {
  browsingDataSummary,
  clearBrowsingData,
} from "@/electron-main/browser-view/browsing-data";
import { z } from "zod";

import { base } from "../base";

/**
 * The in-app browser's cookies, site storage, and cache, for the dialog that
 * clears them: what there is, and clearing it. History is the history
 * store's, under its own route.
 */
const summary = base
  .output(
    z.object({ cacheBytes: z.number(), cookieSites: z.array(z.string()) }),
  )
  .handler(() => browsingDataSummary());

const clear = base
  .input(z.object({ cache: z.boolean(), siteData: z.boolean() }))
  .handler(async ({ input }) => {
    await clearBrowsingData(input);
  });

export const browsingData = { clear, summary };
