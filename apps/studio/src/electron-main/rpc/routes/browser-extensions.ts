import {
  answerExtensionInstall,
  listBrowserExtensions,
  openExtensionDesktopApp,
  recheckExtensionConnections,
  removeBrowserExtension,
  setBrowserExtensionPinned,
} from "@/electron-main/browser-view/extensions";
import { BrowserExtensionSchema } from "@/shared/browser-extensions";
import { liveRead } from "@instrument-org/workspace/electron";
import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { base } from "../base";
import { publisher } from "../publisher";

/**
 * The extensions the in-app browser runs, for the window's row, its puzzle
 * menu and the Extensions page: what is installed, kept current as one is
 * added, removed, pinned or heard from its desktop app, and taking one out.
 * Adding one goes through the Chrome Web Store's own button in a tab, whose
 * question the window answers here.
 */
const live = {
  list: base
    .output(eventIterator(z.array(BrowserExtensionSchema)))
    .handler(async function* ({ signal }) {
      yield* liveRead({
        changes: [
          publisher.subscribe("browser.extensions-changed", { signal }),
        ],
        read: listBrowserExtensions,
      });
    }),
};

const events = {
  installAnswered: base.handler(async function* ({ signal }) {
    for await (const event of publisher.subscribe(
      "browser.extension-install-answered",
      { signal },
    )) {
      yield event;
    }
  }),
  installAsked: base.handler(async function* ({ signal }) {
    for await (const event of publisher.subscribe(
      "browser.extension-install-asked",
      { signal },
    )) {
      yield event;
    }
  }),
};

const answerInstall = base
  .input(z.object({ allow: z.boolean(), askId: z.string() }))
  .handler(({ input }) => {
    answerExtensionInstall(input.askId, input.allow);
  });

const openDesktopApp = base
  .input(z.object({ id: z.string() }))
  .handler(async ({ input }) => {
    await openExtensionDesktopApp(input.id);
  });

/** Asks each extension's desktop app again, for a window coming back to the front. */
const recheck = base.handler(async () => {
  await recheckExtensionConnections();
});

const remove = base
  .input(z.object({ id: z.string() }))
  .handler(async ({ input }) => {
    await removeBrowserExtension(input.id);
  });

const setPinned = base
  .input(z.object({ id: z.string(), pinned: z.boolean() }))
  .handler(({ input }) => {
    setBrowserExtensionPinned(input.id, input.pinned);
  });

export const browserExtensions = {
  answerInstall,
  events,
  live,
  openDesktopApp,
  recheck,
  remove,
  setPinned,
};
