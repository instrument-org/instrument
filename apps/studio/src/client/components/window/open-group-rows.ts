import { sidebarProjectAtom } from "@/client/atoms/tab-groups";
import { type WindowTab } from "@/client/atoms/window";
import { draftsAtom } from "@/client/drafts/store";
import { stripMarkdown } from "@instrument-org/shared/strip-markdown";
import { type ChatId } from "@instrument-org/workspace/client";
import { useAtomValue } from "jotai";

import { useAppsBySlug } from "./apps-by-slug";
import { type Chat, draftTitle, type Project } from "./chats";
import { useFileTabTitles } from "./file-tab-titles";
import { pageTabTitle } from "./file-tabs";
import {
  groupLeadsAtom,
  leadTabOf,
  type RowSides,
  rowSidesOf,
} from "./group-leads";
import { screenPresentation } from "./screen-presentation";
import {
  groupsInProject,
  inSidebarOrder,
  type TabGroup,
  useOpenGroups,
} from "./tab-groups";
import { chatOfTab, draftOfTab, isHomeTab } from "./tab-model";
import { useTaskTitles } from "./task-titles";
import { useWindowTabs } from "./window-tabs";

/** One of this window's tab groups as a list of them shows it. */
export interface OpenGroupRow {
  /** The chat it goes by, where it holds one. */
  chat: ChatId | undefined;
  entry: TabGroup;
  /** Whether it is new tabs nobody has written in and nothing else. */
  isBlank: boolean;
  /** The tab it goes by (`leadTabOf`). */
  lead: WindowTab;
  /** What it is found by: its row's title, or the words of a new chat not sent yet, which its row says under "New Tab". */
  name: string;
  sides: RowSides;
  /** Its row's title. */
  title: string;
}

/**
 * This window's tab groups as the sidebar's rows have them: the ones the
 * sidebar lists, in its order, then the ones it lists inside a project, or
 * outside the one it stands in. A group whose tabs are not in yet is left
 * out.
 */
export function useOpenGroupRows({
  chats,
  chatTitles,
  enabled,
  projects,
}: {
  chats: readonly Chat[];
  chatTitles: Map<ChatId, string>;
  /** Whether the titles pages give themselves are read off the disk. */
  enabled: boolean;
  projects: readonly Project[];
}): OpenGroupRow[] {
  const { open } = useOpenGroups();
  const { layoutOf } = useWindowTabs();
  const leads = useAtomValue(groupLeadsAtom);
  const drafts = useAtomValue(draftsAtom);
  const appsBySlug = useAppsBySlug();
  const taskTitles = useTaskTitles();
  const shown = new Set(
    groupsInProject(open, useAtomValue(sidebarProjectAtom), projects),
  );
  const listed = [
    ...inSidebarOrder(open.filter((entry) => shown.has(entry))),
    ...inSidebarOrder(open.filter((entry) => !shown.has(entry))),
  ].flatMap((entry) => {
    const sides = rowSidesOf(layoutOf(entry.group));
    return sides
      ? [{ entry, lead: leadTabOf(sides, leads.get(entry.group)), sides }]
      : [];
  });
  const fileTitles = useFileTabTitles(
    enabled
      ? listed.map(({ lead }) => (lead.kind === "page" ? undefined : lead.href))
      : [],
  );
  const titleOf = (tab: WindowTab) => {
    if (tab.kind === "page") {
      return pageTabTitle(tab) ?? "";
    }
    const chat = chats.find((each) => each.id === chatOfTab(tab));
    return chat
      ? stripMarkdown(chat.title)
      : screenPresentation(tab.href, {
          appsBySlug,
          chatTitles,
          ...(fileTitles ? { fileTitles } : {}),
          taskTitles,
        }).title;
  };
  return listed.map((row) => {
    const draft = draftOfTab(row.lead);
    const words = drafts.find((each) => each.id === draft)?.words.trim() ?? "";
    const title = draft === undefined ? titleOf(row.lead) : "New Tab";
    return {
      ...row,
      chat: chatOfTab(row.lead),
      isBlank: row.sides.every((side) => side.tabs.every(isHomeTab)),
      name: words === "" ? title : draftTitle(words),
      title,
    };
  });
}
