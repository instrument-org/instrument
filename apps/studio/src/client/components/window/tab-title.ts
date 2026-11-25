import { type WindowTab } from "@/client/atoms/window";
import { type ChatId } from "@instrument-org/workspace/client";

import { useProjectsById } from "./projects-by-id";
import { useAppsBySlug } from "./apps-by-slug";
import { pageTabTitle } from "./file-tabs";
import { screenPresentation } from "./screen-presentation";

/** A tab's title as its group's row would show it. */
export function useTabTitle(chatTitles: Map<ChatId, string>) {
  const appsBySlug = useAppsBySlug();
  const projects = useProjectsById();
  return (tab: WindowTab) =>
    tab.kind === "page"
      ? pageTabTitle(tab) || (tab.url ?? tab.openedUrl ?? "")
      : screenPresentation(tab.href, { appsBySlug, chatTitles, projects })
          .title;
}
