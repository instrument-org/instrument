import { AnimatedOutlineBrandIconGlyph } from "@/client/components/brand-icon";
import { draftsAtom } from "@/client/drafts/store";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { projectFolderPath } from "@/client/lib/show-in-files";
import { storageLocationQueryOptions } from "@/client/lib/output-folder";
import { rpcClient } from "@/client/rpc/client";
import { folderHref } from "@/shared/computer-href";
import { draftOfGroup } from "@/shared/drafts";
import { NO_SIDEBAR_CHANGES, pinnedPlaces } from "@/shared/sidebar-places";
import { folderNameFromPath } from "@instrument-org/shared";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode, useEffect, useRef } from "react";

import { chatListOptions } from "./chat-list-query";
import { useWindow } from "./context";
import { FolderMark } from "./folder-mark";
import { Omnibar } from "./omnibar";
import { ProjectMark } from "./project-mark";
import { useShell } from "./shell-context";
import { chatOfGroup } from "./window-href";
import { useWindowTabs } from "./window-tabs";

/**
 * A new tab in a group, the way a browser's is: the Instrument mark over the
 * address field, which has the caret, finishes addresses and searches the
 * web, and under it the Files sidebar's places in a light row, each turning
 * the tab into Files there. A pale glint crosses the field as the tab
 * arrives. The top of the tab is left clear for the toolbar and bookmarks
 * over it, and ⌘L puts the caret in this field (`focusField`).
 */
export function GroupNewTab({
  group,
  tabId,
}: {
  group: string;
  tabId: string;
}) {
  const windowTabs = useWindowTabs();
  const { browser } = useWindow();
  const isActive = useIsActiveTab();
  const fieldRef = useRef<HTMLDivElement>(null);
  const places = useFilesPlaces(group);

  // The caret in the field whenever the tab comes up, wherever the keyboard
  // was: a new tab is asked for to type an address.
  useEffect(() => {
    if (isActive) {
      fieldRef.current?.querySelector("input")?.focus();
    }
  }, [isActive]);

  const openFolder = (path: string) => {
    windowTabs.visitHref(tabId, folderHref(path));
  };

  return (
    <div className="h-full overflow-y-auto bg-background px-8">
      <div className="mx-auto flex w-full max-w-160 flex-col items-center pt-[max(18vh,--spacing(16))] pb-16">
        <AnimatedOutlineBrandIconGlyph className="size-14 text-brown-500/34 dark:text-brown-900/60" />
        <div
          className="relative mt-8 flex h-12 w-full items-center gap-3 rounded-2xl bg-card px-4 text-sm shadow-sm-soft ring-1 ring-border"
          data-new-tab-field=""
          ref={fieldRef}
        >
          <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground" />
          <Omnibar
            location={{ kind: "newTab" }}
            onSite={(url) => {
              const tab = windowTabs.allTabs.find(
                (entry) => entry.id === tabId,
              );
              browser?.open(url, {
                group,
                ...(tab ? { replacing: tab } : {}),
              });
            }}
            onVisit={(href) => {
              windowTabs.visitHref(tabId, href);
            }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-0.5 field-glint rounded-[18px]"
          />
        </div>
        {places.length > 0 && (
          <div className="mt-5 flex flex-wrap justify-center gap-1">
            {places.map((place) => (
              <button
                className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
                key={place.path}
                onClick={() => {
                  openFolder(place.path);
                }}
                title={place.path}
                type="button"
              >
                {place.icon}
                {place.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The places the Files sidebar keeps, in its order, with the group's
 * project folder first when it is filed under one: the workspace, then
 * Pinned as the person left it. Recents and the disks stay in Files.
 */
function useFilesPlaces(
  group: string,
): { icon: ReactNode; name: string; path: string }[] {
  const shell = useShell();
  const drafts = useAtomValue(draftsAtom);
  const location = useQuery(storageLocationQueryOptions()).data;
  const computer = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const preferences = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const chatId = chatOfGroup(group);
  const { data: chatProject } = useQuery({
    ...chatListOptions(),
    select: (chats) => chats.find((entry) => entry.id === chatId)?.project,
  });
  const draftProject = drafts.find(
    (entry) => entry.id === draftOfGroup(group),
  )?.projectId;
  const project = shell.projects.find(
    (entry) => entry.id === (draftProject ?? chatProject),
  );

  const instrumentPlace = computer.data?.pinned.find(
    (place) => place.kind === "output",
  );
  const pinned = pinnedPlaces(
    (computer.data?.pinned ?? []).filter((place) => place !== instrumentPlace),
    preferences.data?.sidebarPlaces ?? NO_SIDEBAR_CHANGES,
    (path) => ({ name: folderNameFromPath(path), path }),
  );
  return [
    ...(project && location
      ? [
          {
            icon: <ProjectMark project={project} size="sm" />,
            name: project.name,
            path: projectFolderPath(location.rootDir, project.name),
          },
        ]
      : []),
    ...[...(instrumentPlace ? [instrumentPlace] : []), ...pinned].map(
      (place) => ({
        icon: <FolderMark path={place.path} />,
        name: place.name,
        path: place.path,
      }),
    ),
  ];
}
