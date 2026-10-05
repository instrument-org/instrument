import {
  getGuest,
  pageHoldingKeyboard,
  stepPage,
} from "@/client/lib/browser-pool";
import { foregroundBrowser } from "@/client/lib/foreground-browser-registry";
import { BROWSER_ZOOM_MAX, BROWSER_ZOOM_MIN } from "@/shared/browser";
import { steppedZoom } from "@/shared/zoom";
import { type BrowserTargetId } from "@instrument-org/workspace/client";

/**
 * The chords that can mean a page rather than the window: history, reload,
 * zoom, and find. A focused `<webview>` keeps every key from the window's
 * document, so these reach the window only as menu accelerators, which the
 * main process passes on as they are; which page one means is decided here,
 * and only here.
 */
export type PageChord =
  | "back"
  | "findInPage"
  | "forward"
  | "reloadPage"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset";

/**
 * The page a chord means, or null when it means the window's own (its tab's
 * history, its zoom) or nothing at all:
 *
 * - history and zoom mean the page on screen that holds the keyboard, as
 *   they would in a browser; with the caret anywhere else they are the
 *   window's.
 * - reload means that page too, and otherwise the page the person is looking
 *   at, since the window itself has nothing to reload but every tab at once.
 * - find means the page the person is looking at, whose panel has the find
 *   bar.
 */
export function pageForChord(chord: PageChord): BrowserTargetId | null {
  switch (chord) {
    case "findInPage": {
      return foregroundBrowser()?.targetId ?? null;
    }
    case "reloadPage": {
      return pageHoldingKeyboard() ?? foregroundBrowser()?.targetId ?? null;
    }
    case "back":
    case "forward":
    case "zoomIn":
    case "zoomOut":
    case "zoomReset": {
      return pageHoldingKeyboard();
    }
  }
}

/**
 * Does what a chord means to the page it means; false when it means no page,
 * and the window's own meaning (or none) stands.
 */
export function runPageChord(chord: PageChord): boolean {
  const target = pageForChord(chord);
  if (!target) {
    return false;
  }
  switch (chord) {
    case "back":
    case "forward": {
      stepPage(target, chord);
      return true;
    }
    case "findInPage": {
      foregroundBrowser()?.openFind();
      return true;
    }
    case "reloadPage": {
      const guest = getGuest(target);
      guest?.reload();
      return guest !== null;
    }
    case "zoomIn":
    case "zoomOut":
    case "zoomReset": {
      const guest = getGuest(target);
      if (!guest) {
        return false;
      }
      guest.setZoom(
        chord === "zoomReset"
          ? 1
          : steppedZoom({
              direction: chord === "zoomIn" ? "in" : "out",
              factor: guest.zoom(),
              max: BROWSER_ZOOM_MAX,
              min: BROWSER_ZOOM_MIN,
            }),
      );
      return true;
    }
  }
}
