import {
  NEW_TAB_HREF,
  pinsAtom,
  type WindowTab,
} from "@/client/atoms/orchestrator";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { FileIcon } from "@/client/components/file-icon";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { useBrowserAgentActivity } from "@/client/hooks/use-browser-agent-activity";
import { useTargetAgentActivity } from "@/client/hooks/use-target-agent-activity";
import { rpcClient } from "@/client/rpc/client";
import {
  type BrowserTargetId,
  encodeBrowserTargetId,
  StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { type ReactNode, useEffect, useState } from "react";

import { AppIcon } from "./app-icon";
import { TabIcon } from "./browser-tabs";
import { computerName } from "./computer-name";
import { useOrchestrator } from "./context";
import { TabStrip } from "./tab-strip";
import { parseHref } from "./window-tabs";

/** A screen's icon on its own, by its address: for a pin's row. */
export function ScreenIcon({
  appsBySlug,
  href,
}: {
  appsBySlug: Map<string, { name: string; site: string | undefined }>;
  href: string;
}) {
  return screenPresentation(href, { appsBySlug, childTitles: new Map() }).icon;
}

/**
 * The strip along the top of the window: every tab, whatever it holds, drawn
 * the way the task page draws its pane tabs. A page carries its site's icon
 * and title; a screen is named for what it is at. A right click on any tab
 * offers to pin it to the sidebar or close it.
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
  const setPins = useSetAtom(pinsAtom);
  const [menu, setMenu] = useState<{ key: string; x: number; y: number }>();

  useEffect(() => {
    if (!menu) return;
    const close = () => {
      setMenu(undefined);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const pin = (tab: WindowTab) => {
    // A page with no address yet has nothing to come back to.
    const target = tab.kind === "page" ? tab.url : tab.href;
    if (!target) return;
    const title =
      tab.kind === "page"
        ? tab.title || target
        : screenPresentation(tab.href, { appsBySlug, childTitles }).title;
    setPins((pins) =>
      pins.some((pinned) => pinned.target === target)
        ? pins
        : [
            ...pins,
            {
              favicon: tab.kind === "page" ? tab.favicon : undefined,
              id: crypto.randomUUID(),
              kind: tab.kind,
              target,
              title,
            },
          ],
    );
  };

  const menuTab = menu && tabs.find((tab) => tab.id === menu.key);

  // Which tasks are in their browsers right now, one probe per task with a
  // tab here, since the answer is a subscription and the list is a list.
  const [working, setWorking] = useState<ReadonlySet<TaskId>>(new Set());
  const browsingTaskIds = [
    ...new Set(
      tabs.flatMap((tab) =>
        tab.kind === "page" && tab.taskId ? [tab.taskId] : [],
      ),
    ),
  ];
  // And which of the window's own tabs a task is driving, having been handed
  // it: those shimmer too, keyed by the tab rather than by a task.
  const { taskId: ownTaskId } = useOrchestrator();
  const [driven, setDriven] = useState<ReadonlySet<string>>(new Set());
  const ownPageTabs = tabs.flatMap((tab) =>
    tab.kind === "page" && !tab.taskId ? [tab.id] : [],
  );
  const reportDriven = (id: string, isDriven: boolean) => {
    setDriven((current) => {
      if (current.has(id) === isDriven) return current;
      const next = new Set(current);
      if (isDriven) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const reportWorking = (id: TaskId, isWorking: boolean) => {
    setWorking((current) => {
      if (current.has(id) === isWorking) return current;
      const next = new Set(current);
      if (isWorking) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <>
      {browsingTaskIds.map((id) => (
        <BrowserActivityProbe key={id} onChange={reportWorking} taskId={id} />
      ))}
      {ownPageTabs.map((id) => (
        <TargetActivityProbe
          key={id}
          onChange={reportDriven}
          tabId={id}
          targetId={encodeBrowserTargetId(
            ownTaskId,
            StoreId.SessionSchema.parse(id),
          )}
        />
      ))}
      <TabStrip
        className="border-b border-border"
        onClose={onClose}
        onContextMenu={(key, event) => {
          event.preventDefault();
          setMenu({ key, x: event.clientX, y: event.clientY });
        }}
        onNew={onNew}
        onReorder={onReorder}
        onSelect={onSelect}
        selectedKey={selectedId}
        tabs={tabs.map((tab) => ({
          key: tab.id,
          ...(tab.kind === "page"
            ? {
                icon: <TabIcon favicon={tab.favicon} url={tab.url} />,
                isWorking: tab.taskId
                  ? working.has(tab.taskId)
                  : driven.has(tab.id),
                title:
                  tab.title ||
                  (tab.taskId && childTitles.get(tab.taskId)) ||
                  tab.url ||
                  "New tab",
              }
            : screenPresentation(tab.href, { appsBySlug, childTitles })),
        }))}
      />
      {menu && menuTab && (
        <div
          className="fixed z-50 min-w-40 rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          role="menu"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            className="flex w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => {
              pin(menuTab);
              setMenu(undefined);
            }}
            role="menuitem"
            type="button"
          >
            Pin to sidebar
          </button>
          <button
            className="flex w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => {
              onClose(menuTab.id);
              setMenu(undefined);
            }}
            role="menuitem"
            type="button"
          >
            Close tab
          </button>
        </div>
      )}
    </>
  );
}

/** Reports whether a task is in its browser, for the strip to shimmer its tab by. */
function BrowserActivityProbe({
  onChange,
  taskId,
}: {
  onChange: (taskId: TaskId, isWorking: boolean) => void;
  taskId: TaskId;
}) {
  const isWorking = useBrowserAgentActivity(taskId);
  useEffect(() => {
    onChange(taskId, isWorking);
  }, [isWorking, onChange, taskId]);
  return null;
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

/** Reports whether an agent is driving one guest, for the strip to shimmer its tab by. */
function TargetActivityProbe({
  onChange,
  tabId,
  targetId,
}: {
  onChange: (tabId: string, isDriven: boolean) => void;
  tabId: string;
  targetId: BrowserTargetId;
}) {
  const isDriven = useTargetAgentActivity(targetId);
  useEffect(() => {
    onChange(tabId, isDriven);
  }, [isDriven, onChange, tabId]);
  return null;
}
