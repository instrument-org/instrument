import { type TabRouter } from "@/client/lib/tab-router";
import { type TabIconName } from "@instrument-org/shared/icons";
import { type TaskId, TaskIdSchema } from "@instrument-org/workspace/client";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    // Static tab-bar icon for this route (project, table, bug, ...). Tasks omit
    // it; they render a live status ring keyed off `tabTaskIdParam` instead.
    tabIcon?: TabIconName;
    // Name of the path param holding this route's TaskId, surfaced to the tab
    // bar's status ring. Read off the match's params at resolve time.
    tabTaskIdParam?: string;
  }
}

/**
 * Derive a tab's title/icon/taskId from the router's matched routes. Icon and
 * taskId come from each route's typed `staticData`; the title comes from the
 * route `head()` (which may async-fetch a task/project name). The deepest match
 * wins for each field.
 */
export function readRouterTabMeta(router: TabRouter): {
  iconName?: TabIconName;
  taskId?: TaskId;
  title?: string;
} {
  let iconName: TabIconName | undefined;
  let taskId: TaskId | undefined;
  let title: string | undefined;

  for (const match of router.state.matches) {
    const { tabIcon, tabTaskIdParam } = match.staticData;
    if (tabIcon) {
      iconName = tabIcon;
    }
    if (tabTaskIdParam) {
      // Aggregated match params are loosely typed across the route union.
      const params = match.params as Record<string, string | undefined>;
      const parsed = TaskIdSchema.safeParse(params[tabTaskIdParam]);
      taskId = parsed.success ? parsed.data : undefined;
    }
    for (const entry of match.meta ?? []) {
      // Head meta entries are loosely typed; only title tags matter here.
      const meta = entry as { title?: unknown };
      if (typeof meta.title === "string") {
        title = meta.title;
      }
    }
  }

  return { iconName, taskId, title };
}
