import {
  listBrowserExtensions,
  removeBrowserExtension,
} from "@/electron-main/browser-view/extensions";
import { liveRead } from "@instrument-org/workspace/electron";
import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { base } from "../base";
import { publisher } from "../publisher";

const ExtensionSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
});

/**
 * The extensions the in-app browser runs, for the Browser page of Settings:
 * what is installed, kept current as one is added or removed, and taking one
 * out. Adding one goes through the Chrome Web Store's own button in a tab.
 */
const live = {
  list: base
    .output(eventIterator(z.array(ExtensionSchema)))
    .handler(async function* ({ signal }) {
      yield* liveRead({
        changes: [
          publisher.subscribe("browser.extensions-changed", { signal }),
        ],
        read: listBrowserExtensions,
      });
    }),
};

const remove = base
  .input(z.object({ id: z.string() }))
  .handler(async ({ input }) => {
    await removeBrowserExtension(input.id);
  });

export const browserExtensions = { live, remove };
