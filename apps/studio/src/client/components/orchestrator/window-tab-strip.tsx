import { NEW_TAB_HREF, type WindowTab } from "@/client/atoms/orchestrator";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { FileIcon } from "@/client/components/file-icon";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

import { AppIcon } from "./app-icon";
import { TabIcon } from "./browser-tabs";
import { computerName } from "./computer-name";
import { TabStrip } from "./tab-strip";
import { parseHref } from "./window-tabs";

/**
 * The strip along the top of the window: every tab, whatever it holds, drawn
 * the way the task page draws its pane tabs. A page carries its site's icon
 * and title; a screen is named for what it is at.
 */
export function WindowTabStrip({
  childTitles,
  onClose,
  onNew,
  onReorder,
  onSelect,
  selectedId,
  tabs,
}: {
  childTitles: Map<TaskId, string>;
  onClose: (id: string) => void;
  onNew: () => void;
  onReorder: (ids: string[]) => void;
  onSelect: (id: string) => void;
  selectedId: string | undefined;
  tabs: WindowTab[];
}) {
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const appsBySlug = new Map(
    (apps.data?.apps ?? []).map((app) => [
      app.slug,
      { name: app.name, site: app.site },
    ]),
  );
  return (
    <TabStrip
      className="border-b border-border"
      onClose={onClose}
      onNew={onNew}
      onReorder={onReorder}
      onSelect={onSelect}
      selectedKey={selectedId}
      tabs={tabs.map((tab) => ({
        key: tab.id,
        ...(tab.kind === "page"
          ? {
              icon: <TabIcon favicon={tab.favicon} url={tab.url} />,
              title: tab.title || tab.url || "New tab",
            }
          : screenPresentation(tab.href, { appsBySlug, childTitles })),
      }))}
    />
  );
}

/** What a screen tab is called and drawn with, read off its address. */
function screenPresentation(
  href: string,
  {
    appsBySlug,
    childTitles,
  }: {
    appsBySlug: Map<string, { name: string; site: string | undefined }>;
    childTitles: Map<TaskId, string>;
  },
): { icon: ReactNode; title: string } {
  const { pathname, search } = parseHref(href);
  if (pathname === NEW_TAB_HREF) {
    return {
      icon: <MagnifyingGlassIcon className="size-3.5" />,
      title: "New tab",
    };
  }
  if (pathname === "/orchestrator/computer") {
    const file = search.get("file");
    if (file) {
      const name = file.split("/").at(-1) ?? file;
      return {
        icon: <FileIcon className="size-4" filename={name} />,
        title: name,
      };
    }
    const folder = (search.get("path") ?? "")
      .replace(/\/$/, "")
      .split("/")
      .at(-1);
    return {
      icon: <FileSystemFolderGlyph className="h-3 w-auto" />,
      title: folder || computerName(),
    };
  }
  if (pathname.startsWith("/orchestrator/tasks/")) {
    const id = pathname.slice("/orchestrator/tasks/".length) as TaskId;
    return {
      icon: <InstrumentGlyph className="size-3.5" />,
      title: childTitles.get(id) ?? "Task",
    };
  }
  if (pathname === "/orchestrator/tasks") {
    return { icon: <InstrumentGlyph className="size-3.5" />, title: "Tasks" };
  }
  if (pathname.startsWith("/orchestrator/apps/")) {
    const slug = pathname.slice("/orchestrator/apps/".length);
    const app = appsBySlug.get(slug);
    return {
      icon: app ? (
        <AppIcon site={app.site} size="sm" />
      ) : (
        <AppWindowIcon className="size-3.5" />
      ),
      title: app?.name ?? slug,
    };
  }
  if (pathname === "/orchestrator/apps") {
    return { icon: <AppWindowIcon className="size-3.5" />, title: "Apps" };
  }
  return { icon: <MagnifyingGlassIcon className="size-3.5" />, title: "Tab" };
}
