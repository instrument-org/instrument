import { type WindowTab } from "@/client/atoms/window";
import { type ChatId } from "@instrument-org/workspace/client";

import { useProjectsById } from "./projects-by-id";
import { useAppsBySlug } from "./apps-by-slug";
import { useComputerVolumes } from "./computer-volumes";
import { pageTabTitle } from "./file-tabs";
import { type ScreenNames, screenPresentation } from "./screen-presentation";
import { useTaskTitles } from "./task-titles";

/**
 * What a tab is called, in the strip, the sidebar, the chips, History and the
 * agent's window list alike: a page's title (`pageTabTitle`), or what a
 * screen's address stands on.
 */
export function tabTitle(tab: WindowTab, names: ScreenNames): string {
  return tab.kind === "page"
    ? pageTabTitle(tab)
    : screenPresentation(tab.href, names).title;
}

/** The names a tab's address alone can't say, but the titles files give themselves (`useFileTabTitles`). */
export function useTabNames(chatTitles: Map<ChatId, string>) {
  const appsBySlug = useAppsBySlug();
  const projects = useProjectsById();
  const taskTitles = useTaskTitles();
  const volumes = useComputerVolumes();
  return {
    appsBySlug,
    chatTitles,
    projects,
    taskTitles,
    ...(volumes ? { volumes } : {}),
  } satisfies ScreenNames;
}

/** A tab's title as its group's row would show it. */
export function useTabTitle(chatTitles: Map<ChatId, string>) {
  const names = useTabNames(chatTitles);
  return (tab: WindowTab) => tabTitle(tab, names);
}
