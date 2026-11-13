import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { keepsOffScreen } from "@/electron-main/windows/on-screen";
import { type Tab } from "@/shared/tabs";
import { type BrowserTargetId } from "@instrument-org/workspace/electron";
import { BrowserWindow, screen, webContents } from "electron";

import { openNewAppWindow } from "./app-window";
import { canPlaceWindows } from "./tab-carry";
import { boundsAtRelease, type Point } from "./tab-carry-rules";
import { openTabPicture, type TabPicture } from "./tab-picture";

/** How often the picture follows the cursor: at the display's pace. */
const FOLLOW_MS = 8;

/** A group's tab dragged past its window's edge, which opens a window of its own where it is let go. */
interface GroupTabPull {
  readonly from: BrowserWindow;
  /** What goes with the pointer while the tab is off the window; none where nothing can follow it. */
  picture: null | TabPicture;
  poll: NodeJS.Timeout | null;
}

let pull: GroupTabPull | null = null;

function windowOf(webContentsId: number) {
  const contents = webContents.fromId(webContentsId);
  return contents ? BrowserWindow.fromWebContents(contents) : null;
}

function stopPull() {
  if (!pull) {
    return;
  }
  if (pull.poll) {
    clearInterval(pull.poll);
  }
  pull.picture?.close();
  pull = null;
}

/**
 * The tab is off its window or back on it. Off it, a small picture of the
 * window goes with the pointer, as a tab torn off a window's strip has, so
 * letting go reads as making a window there.
 */
export function noteGroupTabPull(webContentsId: number, isOff: boolean) {
  const from = windowOf(webContentsId);
  if (!from) {
    return;
  }
  if (pull?.from !== from) {
    stopPull();
    pull = {
      from,
      picture:
        canPlaceWindows() && !keepsOffScreen() ? openTabPicture(from) : null,
      poll: null,
    };
  }
  const current = pull;
  if (!current.picture) {
    return;
  }
  if (!isOff) {
    if (current.poll) {
      clearInterval(current.poll);
      current.poll = null;
    }
    current.picture.hide();
    return;
  }
  if (!current.poll) {
    current.picture.show(screen.getCursorScreenPoint());
    current.poll = setInterval(() => {
      current.picture?.moveTo(screen.getCursorScreenPoint());
    }, FOLLOW_MS);
  }
}

/**
 * The drag is over. With `open`, the tab goes to a window of its own at the
 * group it now stands in, under the pointer where a drag let it go off its
 * window and otherwise a step off the one in front, and the tab's pages go
 * to it, so a page shown there does not wait on the window it left.
 */
export function endGroupTabPull(
  webContentsId: number,
  open?: {
    isAtPointer: boolean;
    pages: readonly BrowserTargetId[];
    tabs: readonly Tab[];
  },
) {
  const from = pull?.from ?? windowOf(webContentsId);
  stopPull();
  if (!open || !from || from.isDestroyed()) {
    return;
  }
  const at: Point = screen.getCursorScreenPoint();
  const opened = openNewAppWindow(
    open.tabs,
    open.isAtPointer && canPlaceWindows()
      ? {
          bounds: boundsAtRelease(
            at,
            from.getNormalBounds(),
            screen.getDisplayNearestPoint(at).workArea,
          ),
        }
      : {},
  );
  if (!opened) {
    return;
  }
  const manager = getBrowserViewManager();
  for (const page of open.pages) {
    void manager.handOffGuest(page, opened.webContents.id);
  }
}
