import { useTabGroupActions } from "./tab-groups";
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

/**
 * A group's tab dragged out of its row and let go over the sidebar: onto
 * another group's row it moves into that group, and onto the list's empty
 * space it becomes a group of its own at the bottom of the list. Either
 * way that group comes up.
 */
export function useTabDragToSidebar() {
  const windowTabs = useWindowTabs();
  const groups = useTabGroupActions();
  return {
    onTabDrag: (_id: string, event: PointerEvent) => {
      light(dropTargetAt(event.clientX, event.clientY)?.element);
    },
    onTabDragEnd: (id: string, event: PointerEvent) => {
      light(undefined);
      const target = dropTargetAt(event.clientX, event.clientY);
      if (!target) {
        return;
      }
      const from = windowTabs.allTabs.find((tab) => tab.id === id)?.group;
      // The window follows the tab, which stays the one up, as a browser's
      // tab dragged into another window does.
      if (target.group === undefined) {
        groups.make({ moving: id });
      } else if (target.group !== from) {
        groups.moveTab(id, target.group);
        groups.show(target.group);
      }
    },
  };
}
