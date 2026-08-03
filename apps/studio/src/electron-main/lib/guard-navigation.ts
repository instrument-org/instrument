import { type WebContents } from "electron";

import { openExternal } from "./open-external";
import { studioURL } from "./urls";

/**
 * Keeps a window on the app, and sends everything else to the real browser.
 *
 * `setWindowOpenHandler` only covers the openings that ask for a new window —
 * `target="_blank"`, `window.open`. A plain link navigates the window it is
 * already in, and with nothing watching for that, one click replaces the whole
 * app with a web page: same window, no chrome, no way back, and the renderer's
 * privileges handed to whatever loaded.
 *
 * Reaching that point takes only a link on the page, and pages here are built
 * from model output — a markdown link, a diagram that declared one, an HTML
 * artifact. Rather than audit every renderer that might emit an anchor, the
 * window refuses to leave, and the link opens where a link should.
 */
export function guardNavigation(contents: WebContents): void {
  contents.on("will-navigate", (event, url) => {
    if (isStudioURL(url)) {
      return;
    }
    event.preventDefault();
    // Vets the protocol before handing it to the OS, so a `file:` or custom
    // scheme dressed up as a link does not get to pick the program.
    void openExternal(url);
  });
}

/**
 * Whether a URL is the renderer itself.
 *
 * Studio is a hash router, so its own routes differ only past the `#` — which
 * is a same-document navigation the window never asks permission for. Anything
 * that reaches this and is not the renderer document is something else.
 */
export function isStudioURL(target: string): boolean {
  try {
    const app = new URL(studioURL("/"));
    const url = new URL(target);
    // `file:` URLs report an origin of "null", so the pathname is what
    // separates the packaged renderer from any other file on disk.
    return url.origin === app.origin && url.pathname === app.pathname;
  } catch {
    return false;
  }
}
