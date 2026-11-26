import { type ChatId, type StoreId } from "@instrument-org/workspace/client";
import { atom, type Atom, useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { isEqual } from "radashi";

import { appTabsAtom } from "./app-tabs";
import { useTaskTitlesOf } from "./child-tasks-query";
import { tasksOfHref } from "./tab-location";
import { type WindowTabs } from "./tab-model";
import { useTabsAtom } from "./window-tabs";

type TaskOnTab = { chat: ChatId; id: StoreId.Session };

/**
 * Each title of a task a tab stands on, by the task's session: a task's page
 * among the screens. Read chat by chat, so only the chats whose tasks are on
 * the strips are read.
 */
export function useTaskTitles(): Map<StoreId.Session, string> {
  const tabs = useTabsAtom();
  return useTaskTitlesOf(useAtomValue(tasksOnTabsAtomOf(tabs)));
}

/** One list per tabs read, shared by every row that reads it. */
const tasksOnTabs = new WeakMap<Atom<WindowTabs>, Atom<readonly TaskOnTab[]>>();

/**
 * The tasks the tabs stand on, in session order: the same list until a task
 * comes or goes, so a change to the tabs that leaves them alone draws nothing
 * that reads their titles.
 */
function tasksOnTabsAtomOf(tabs: Atom<WindowTabs>): Atom<readonly TaskOnTab[]> {
  const known = tasksOnTabs.get(tabs);
  if (known) {
    return known;
  }
  const made = selectAtom(
    atom((get) => {
      const tasks = new Map<StoreId.Session, ChatId>();
      const hrefs = [
        ...get(appTabsAtom).tabs.map((tab) => tab.pathname),
        ...get(tabs).tabs.flatMap((tab) =>
          tab.kind === "page" ? [] : [tab.href],
        ),
      ];
      for (const href of hrefs) {
        const named = tasksOfHref(href);
        if (named?.task && named.chat) {
          tasks.set(named.task, named.chat);
        }
      }
      return [...tasks.entries()]
        .map(([id, chat]) => ({ chat, id }))
        .toSorted((a, b) => a.id.localeCompare(b.id));
    }),
    (list) => list,
    isEqual,
  );
  tasksOnTabs.set(tabs, made);
  return made;
}
