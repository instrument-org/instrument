import { type ChatId, type StoreId } from "@instrument-org/workspace/client";
import { useAtomValue } from "jotai";

import { appTabsAtom } from "./app-tabs";
import { useTaskTitlesOf } from "./child-tasks-query";
import { tasksOfHref } from "./tab-location";
import { windowTabsAtom } from "./window-tabs";

/**
 * Each title of a task a tab stands on, by the task's session: a task's page
 * among the screens. Read chat by chat, so only the chats whose tasks are on
 * the strips are read.
 */
export function useTaskTitles(): Map<StoreId.Session, string> {
  const appTabs = useAtomValue(appTabsAtom);
  const windowTabs = useAtomValue(windowTabsAtom);
  const tasks = new Map<StoreId.Session, ChatId>();
  const hrefs = [
    ...appTabs.tabs.map((tab) => tab.pathname),
    ...windowTabs.tabs.flatMap((tab) =>
      tab.kind === "page" ? [] : [tab.href],
    ),
  ];
  for (const href of hrefs) {
    const named = tasksOfHref(href);
    if (named?.task && named.chat) {
      tasks.set(named.task, named.chat);
    }
  }
  return useTaskTitlesOf(
    [...tasks.entries()]
      .map(([id, chat]) => ({ chat, id }))
      .toSorted((a, b) => a.id.localeCompare(b.id)),
  );
}
