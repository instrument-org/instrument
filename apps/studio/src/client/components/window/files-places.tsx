import { draftsAtom } from "@/client/drafts/store";
import { projectFolderPath } from "@/client/lib/show-in-files";
import { storageLocationQueryOptions } from "@/client/lib/output-folder";
import { rpcClient } from "@/client/rpc/client";
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
import { draftOfTab } from "./tab-model";
import { useWindowTabs } from "./window-tabs";

export interface Place {
  icon: ReactNode;
  name: string;
  path: string;
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
  const windowTabs = useWindowTabs();
  const chatId = windowTabs.chatUpIn(group);
  const up = windowTabs.selectedTabIn(group);
  const draftUp = up === undefined ? undefined : draftOfTab(up);
  const { data: chatProject } = useQuery({
    ...chatListOptions(),
    select: (chats) => chats.find((entry) => entry.id === chatId)?.project,
  });
  const draftProject = drafts.find((entry) => entry.id === draftUp)?.projectId;
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
