import { hostPathOfComputerFileUrl } from "@/client/lib/computer-file-url";
import { targetIdFromPartition } from "@/shared/browser";
import {
  type LayoutTab,
  type WindowBox,
  type WindowLook,
  type WindowOwner,
} from "@instrument-org/workspace/client";

/** How far apart the points of the grid are, in CSS px. */
const STEP_PX = 12;
/** The most points across or down. */
const STEPS_MAX = 400;
/** How long the window has to draw: one that is not on screen draws nothing. */
const DRAW_TIMEOUT_MS = 600;
/** The longest side of a picture that is only an icon, in CSS px. */
const ICON_PX = 40;

/** What floats over the window's parts, wherever in the document it is put. */
const FLOATING = [
  "[data-radix-popper-content-wrapper]",
  "[data-sonner-toast]",
  "[popover]:popover-open",
  "[role=alertdialog]",
  "[role=dialog]",
  "[role=listbox]",
  "[role=menu]",
  "[role=tooltip]",
].join(", ");

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
 * What the window draws where, read off the document by asking what is on
 * top at each point of a grid. A point over anything not named here is -1,
 * so something new that comes to stand over the window is left out of a
 * picture until it is named.
 */
export function readWindowLook(
  tabUp: (tabId: string) => undefined | { root?: string; tab: LayoutTab },
): WindowLook {
  const columns = Math.min(STEPS_MAX, Math.ceil(innerWidth / STEP_PX));
  const rows = Math.min(STEPS_MAX, Math.ceil(innerHeight / STEP_PX));
  const owners: WindowOwner[] = [{ kind: "frame" }];
  const indexes = new Map<string, number>();
  const indexOf = (key: string, owner: () => undefined | WindowOwner) => {
    const known = indexes.get(key);
    if (known !== undefined) {
      return known;
    }
    const made = owner();
    const index = made === undefined ? -1 : owners.push(made) - 1;
    indexes.set(key, index);
    return index;
  };
  const sideOwner = (page: Element) => {
    const tabId = page
      .closest("[data-group-side]")
      ?.getAttribute("data-tab-up");
    return tabId === null || tabId === undefined
      ? -1
      : indexOf(`side ${tabId}`, () => {
          const up = tabUp(tabId);
          return up && { kind: "side", ...up };
        });
  };
  const ownerOf = (element: Element): number => {
    if (element.closest(FLOATING)) {
      return -1;
    }
    if (element instanceof HTMLElement && element.tagName === "WEBVIEW") {
      const tabId = targetIdFromPartition(
        element.getAttribute("partition") ?? undefined,
      );
      return tabId === null
        ? -1
        : indexOf(`page ${tabId}`, () => ({ kind: "page", tabId }));
    }
    const page = element.closest("[data-side-page]");
    if (page) {
      return sideOwner(page);
    }
    // The sidebar, a side's own row of tabs, and the ground the cards stand
    // on: an element of the frame's that has the sides inside it.
    return element.closest('nav[aria-label="Tab groups"], [data-group-side]') ||
      (element.closest("[data-window-frame]") &&
        element.querySelector("[data-group-side]"))
      ? 0
      : -1;
  };
  const points: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const element = document.elementFromPoint(
        Math.min(innerWidth - 1, (column / columns) * innerWidth),
        Math.min(innerHeight - 1, (row / rows) * innerHeight),
      );
      points.push(element ? ownerOf(element) : -1);
    }
  }
  return {
    columns,
    covers: [...document.querySelectorAll(FLOATING)].flatMap(seenBox),
    owners,
    pictures: [
      ...document.querySelectorAll(
        PICTURED.split(", ")
          .map((each) => `[data-group-up] [data-side-page] ${each}`)
          .join(", "),
      ),
    ].flatMap((element) => {
      const page = element.closest("[data-side-page]");
      const owner = page ? sideOwner(page) : -1;
      const [box] = seenBox(element);
      if (owner < 0 || box === undefined) {
        return [];
      }
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
          owner,
        },
      ];
    }),
    points,
    rows,
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
