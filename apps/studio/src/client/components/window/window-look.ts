import { hostPathOfComputerFileUrl } from "@/client/lib/computer-file-url";
import {
  type LayoutTab,
  type WindowBox,
  type WindowLook,
  type WindowSide,
} from "@instrument-org/workspace/client";

/** How long the window has to draw: one that is not on screen draws nothing. */
const DRAW_TIMEOUT_MS = 600;
/** The longest side of a picture that is only an icon, in CSS px. */
const ICON_PX = 40;

/** What draws something other than the document's own words and shapes. */
const PICTURED = "img, video, canvas, iframe, object, embed, picture";

/**
 * Settles once the window has drawn two frames, so what it says it shows is
 * on screen; false when it draws none, covered or put away.
 */
export async function windowDraws(): Promise<boolean> {
  if (document.visibilityState === "hidden") {
    return false;
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, DRAW_TIMEOUT_MS);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  });
}

/**
 * What the window draws where: the page of each side of the tab group on
 * screen, by the tab up on it, and every picture drawn in the window, with
 * the side it is in.
 */
export function readWindowLook(
  tabUp: (tabId: string) => undefined | { root?: string; tab: LayoutTab },
): WindowLook {
  const cards = [
    ...document.querySelectorAll<HTMLElement>(
      "[data-group-up] [data-group-side]",
    ),
  ];
  const sides: WindowSide[] = [];
  const sideOfCard = new Map<Element, number>();
  for (const card of cards) {
    const tabId = card.getAttribute("data-tab-up");
    const page = card.querySelector(":scope > [data-side-page]");
    const up = tabId === null ? undefined : tabUp(tabId);
    const [box] = page ? seenBox(page) : [];
    if (up !== undefined && box !== undefined) {
      sideOfCard.set(card, sides.push({ box, ...up }) - 1);
    }
  }
  return {
    pictures: [...document.querySelectorAll(PICTURED)].flatMap((element) => {
      const [box] = seenBox(element);
      if (box === undefined) {
        return [];
      }
      const card = element.closest("[data-group-side]");
      const side = card ? sideOfCard.get(card) : undefined;
      const src =
        element instanceof HTMLImageElement ||
        element instanceof HTMLVideoElement
          ? element.currentSrc || element.src
          : "";
      const file = hostPathOfComputerFileUrl(src);
      const { height, width } = element.getBoundingClientRect();
      return [
        {
          box,
          ...(file === undefined ? {} : { file }),
          isIcon:
            element instanceof HTMLImageElement &&
            Math.max(height, width) <= ICON_PX,
          ...(side === undefined ? {} : { side }),
        },
      ];
    }),
    sides,
  };
}

/** What of an element can be seen, as a part of the window; nothing for one out of sight. */
function seenBox(element: Element): WindowBox[] {
  if (
    !element.checkVisibility({
      checkOpacity: true,
      checkVisibilityCSS: true,
      contentVisibilityAuto: true,
    })
  ) {
    return [];
  }
  const rect = element.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(innerWidth, rect.right);
  const bottom = Math.min(innerHeight, rect.bottom);
  return right <= left || bottom <= top
    ? []
    : [
        {
          height: (bottom - top) / innerHeight,
          width: (right - left) / innerWidth,
          x: left / innerWidth,
          y: top / innerHeight,
        },
      ];
}
