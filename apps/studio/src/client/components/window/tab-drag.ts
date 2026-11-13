import { freshTabId } from "@/client/lib/tab-actions";
import { rpcClient } from "@/client/rpc/client";
import { browserTargetOf } from "@instrument-org/workspace/client";

import { groupHref, useTabGroupActions } from "./tab-groups";
import { isOffWindow } from "./tab-pull";
import { useWindowTabs } from "./window-tabs";

/** The row or list a point is over in the sidebar, if any. */
function dropTargetAt(x: number, y: number) {
  const element = document.elementFromPoint(x, y);
  const row = element?.closest<HTMLElement>("[data-group-row]");
  if (row) {
    return { element: row, group: row.dataset.groupRow };
  }
  const list = element?.closest<HTMLElement>("[data-group-list]");
  return list ? { element: list, group: undefined } : undefined;
}

/** What the drag last lit, to put out again. */
let lit: HTMLElement | undefined;

function light(element: HTMLElement | undefined) {
  if (lit === element) {
    return;
  }
  lit?.removeAttribute("data-drop-target");
  lit = element;
  lit?.setAttribute("data-drop-target", "");
}

/** Whether the tab in hand was off the window when main last heard, by the drag it is. */
let offWindow: { id: string; isOff: boolean } | undefined;

function offWindowAt(event: PointerEvent) {
  return isOffWindow(
    { x: event.clientX, y: event.clientY },
    { height: window.innerHeight, width: window.innerWidth },
  );
}

/**
 * A group's tab dragged out of its row. Let go over the sidebar, onto another
 * group's row it moves into that group, and onto the list's empty space it
 * becomes a group of its own at the bottom of the list; either way that group
 * comes up. Let go off the window, it becomes a group of its own in a window
 * of its own, opened under the pointer, and this window stays on its group.
 */
export function useGroupTabDrag() {
  const windowTabs = useWindowTabs();
  const groups = useTabGroupActions();

  /**
   * A tab to a group of its own in a window of its own, under the pointer
   * when a drag let it go there, and otherwise a step off this one.
   */
  const toNewWindow = (
    id: string,
    { isAtPointer }: { isAtPointer: boolean },
  ) => {
    const tab = windowTabs.allTabs.find((each) => each.id === id);
    if (!tab) {
      return;
    }
    const group = groups.make({ isShownHere: false, moving: id });
    void rpcClient.window.endGroupTabPull
      .call({
        open: {
          isAtPointer,
          pages: tab.kind === "page" ? [browserTargetOf(id)] : [],
          tabs: [{ id: freshTabId(), pathname: groupHref(group) }],
        },
      })
      .catch(() => undefined);
  };

  return {
    onTabDrag: (id: string, event: PointerEvent) => {
      // A page runs in a process of its own, which takes a pointer that
      // crosses it, and the release with it.
      document.documentElement.toggleAttribute("data-group-tab-held", true);
      const isOff = offWindowAt(event);
      light(
        isOff ? undefined : dropTargetAt(event.clientX, event.clientY)?.element,
      );
      if (offWindow?.id !== id || offWindow.isOff !== isOff) {
        // Main has a picture of the window go with the pointer off it.
        if (offWindow?.id === id || isOff) {
          void rpcClient.window.noteGroupTabPull
            .call({ isOff })
            .catch(() => undefined);
        }
        offWindow = { id, isOff };
      }
    },
    onTabDragEnd: (id: string, event: PointerEvent) => {
      document.documentElement.removeAttribute("data-group-tab-held");
      light(undefined);
      const wasNoted = offWindow?.id === id;
      offWindow = undefined;
      if (offWindowAt(event)) {
        toNewWindow(id, { isAtPointer: true });
        return;
      }
      if (wasNoted) {
        void rpcClient.window.endGroupTabPull.call({}).catch(() => undefined);
      }
      const target = dropTargetAt(event.clientX, event.clientY);
      if (!target) {
        return;
      }
      const from = windowTabs.allTabs.find((each) => each.id === id)?.group;
      // The window follows the tab, which stays the one up, as a browser's
      // tab dragged into another window does.
      if (target.group === undefined) {
        groups.make({ moving: id });
      } else if (target.group !== from) {
        groups.moveTab(id, target.group);
        groups.show(target.group);
      }
    },
    toNewWindow,
  };
}
