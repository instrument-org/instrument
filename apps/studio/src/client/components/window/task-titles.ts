import { windowTabsAtom } from "@/client/atoms/window";
import { type TaskId } from "@instrument-org/workspace/client";
import { useAtomValue } from "jotai";

import { appTabsAtom } from "./app-tabs";
import { useTaskTitlesOf } from "./child-tasks-query";
import { tasksOfHref } from "./tab-location";

/**
 * Each title of a task a tab stands on, by the task's id: a task's page
 * among the screens, and a task's browsing among the pages. Read task by
 * task, so only the tasks on the strips are read.
 */
export function useTaskTitles(): Map<TaskId, string> {
  const appTabs = useAtomValue(appTabsAtom);
  const windowTabs = useAtomValue(windowTabsAtom);
  const ids = new Set<TaskId>();
  for (const tab of appTabs.tabs) {
    const task = tasksOfHref(tab.pathname)?.task;
    if (task) {
      ids.add(task);
    }
  }
  for (const tab of windowTabs.tabs) {
    const task = tab.kind === "page" ? tab.taskId : tasksOfHref(tab.href)?.task;
    if (task) {
      ids.add(task);
    }
  }
  return useTaskTitlesOf([...ids].toSorted());
}
