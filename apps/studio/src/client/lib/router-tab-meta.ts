import { type TabRouter } from "@/client/lib/tab-router";
import { META_TAGS } from "@/shared/tabs";
import { type TabIconName, TabIconsSchema } from "@instrument-org/shared/icons";
import { type TaskId, TaskIdSchema } from "@instrument-org/workspace/client";

/**
 * Extract a tab's title/icon/taskId from the resolved head meta of the router's
 * matched routes. Routes keep declaring these in `head()` (including async heads
 * that fetch a task/project name); this is what consumes them now that the old
 * main-process page-scraping is gone. The deepest match's title wins.
 */
export function readRouterTabMeta(router: TabRouter): {
  iconName?: TabIconName;
  taskId?: TaskId;
  title?: string;
} {
  let title: string | undefined;
  let rawIcon: string | undefined;
  let rawTaskId: string | undefined;

  for (const match of router.state.matches) {
    for (const entry of match.meta ?? []) {
      // Head meta entries are loosely typed (title tags vs named metas).
      const meta = entry as {
        content?: unknown;
        name?: unknown;
        title?: unknown;
      };
      if (typeof meta.title === "string") {
        title = meta.title;
      }
      if (
        meta.name === META_TAGS.iconName &&
        typeof meta.content === "string"
      ) {
        rawIcon = meta.content;
      }
      if (meta.name === META_TAGS.taskId && typeof meta.content === "string") {
        rawTaskId = meta.content;
      }
    }
  }

  const icon = rawIcon ? TabIconsSchema.safeParse(rawIcon) : null;
  const taskId = rawTaskId ? TaskIdSchema.safeParse(rawTaskId) : null;
  return {
    iconName: icon?.success ? icon.data : undefined,
    taskId: taskId?.success ? taskId.data : undefined,
    title,
  };
}
