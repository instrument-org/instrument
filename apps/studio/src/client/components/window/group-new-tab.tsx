import { draftsAtom } from "@/client/drafts/store";
import { projectFolderPath } from "@/client/lib/show-in-files";
import { storageLocationQueryOptions } from "@/client/lib/output-folder";
import { rpcClient } from "@/client/rpc/client";
import { folderHref } from "@/shared/computer-href";
import { draftOfGroup } from "@/shared/drafts";
import { NO_SIDEBAR_CHANGES, pinnedPlaces } from "@/shared/sidebar-places";
import { folderNameFromPath } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { unique } from "radashi";
import { type ReactNode } from "react";

import { chatListOptions } from "./chat-list-query";
import { FolderMark } from "./folder-mark";
import { ProjectMark } from "./project-mark";
import { useShell } from "./shell-context";
import { useWindowTabs } from "./window-tabs";

/**
 * What a new tab in a group shows under its toolbar and bookmarks: the
 * places the Files sidebar keeps, as the Finder's sidebar lists them, each
 * turning the tab into Files there. The address field is the toolbar's.
 */
export function GroupNewTab({
  group,
  tabId,
}: {
  group: string;
  tabId: string;
}) {
  const windowTabs = useWindowTabs();
  const { project, places } = useFilesPlaces(group);
  const openFolder = (path: string) => {
    windowTabs.visitHref(tabId, folderHref(path));
  };
  return (
    <div className="h-full overflow-y-auto bg-background px-8">
      <nav
        aria-label="Places"
        // As wide as its longest row, centered as a block, its rows' names
        // aligned down its left.
        className="mx-auto flex w-fit max-w-64 min-w-44 flex-col gap-4 pt-[max(14vh,--spacing(12))] pb-12 text-[13px]"
      >
        {project && (
          <PlaceSection label="Project">
            <PlaceRow onOpen={openFolder} place={project} />
          </PlaceSection>
        )}
        {places.length > 0 && (
          <PlaceSection label="Places">
            {places.map((place) => (
              <PlaceRow key={place.path} onOpen={openFolder} place={place} />
            ))}
          </PlaceSection>
        )}
      </nav>
    </div>
  );
}

/** A heading the Finder's sidebar would give a run of places, small and dim, over them. */
function PlaceSection({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <section>
      <h2 className="px-2 pb-1 text-[11px] font-semibold text-muted-foreground/70">
        {label}
      </h2>
      <ul className="flex flex-col gap-px">{children}</ul>
    </section>
  );
}

export interface Place {
  icon: ReactNode;
  name: string;
  path: string;
}

/** A place as a row of the Finder's sidebar: its mark and its name. */
function PlaceRow({
  onOpen,
  place,
}: {
  onOpen: (path: string) => void;
  place: Place;
}) {
  return (
    <li>
      <button
        className="flex h-7 w-full cursor-default items-center gap-2 rounded-md px-2 text-left text-foreground/85 hover:bg-foreground/6 hover:text-foreground"
        onClick={() => {
          onOpen(place.path);
        }}
        title={place.path}
        type="button"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          {place.icon}
        </span>
        <span className="min-w-0 truncate">{place.name}</span>
      </button>
    </li>
  );
}

/**
 * The places the Files sidebar keeps, in its order: the workspace, then
 * Pinned as the person left it, each folder once, and apart from them the
 * group's project folder when it is filed under one. Recents and the disks
 * stay in Files.
 */
export function useFilesPlaces(group: string): {
  places: Place[];
  project: Place | undefined;
} {
  const shell = useShell();
  const drafts = useAtomValue(draftsAtom);
  const location = useQuery(storageLocationQueryOptions()).data;
  const computer = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const preferences = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const chatId = useWindowTabs().chatsIn(group)[0];
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
  return {
    places: unique(
      [...(instrumentPlace ? [instrumentPlace] : []), ...pinned],
      (place) => place.path,
    ).map((place) => ({
      icon: <FolderMark path={place.path} size="large" />,
      name: place.name,
      path: place.path,
    })),
    project:
      project && location
        ? {
            icon: <ProjectMark project={project} size="sm" />,
            name: project.name,
            path: projectFolderPath(location.rootDir, project.name),
          }
        : undefined,
  };
}
