import { type WindowTab } from "@/client/atoms/window";
import { targetOfAddress } from "@/client/bookmarks/address";
import { keptPathsAtom } from "@/client/bookmarks/store";
import { useRecentFiles } from "@/client/hooks/use-recent-files";
import { rpcClient } from "@/client/rpc/client";
import { NO_SIDEBAR_CHANGES, pinnedPlaces } from "@/shared/sidebar-places";
import { folderNameFromPath } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";

import { chatListOptions } from "./chat-list-query";
import { type Chat, type Project } from "./chats";
import { type OfferedPage, useKnownPages } from "./known-pages";
import { type Named, usageOf } from "./name-search";
import { bareAddress, folderNameOf } from "./omnibar-match";
import { whereOfAddress } from "./row-text";
import { useShell } from "./shell-context";
import { useOpenGroups } from "./tab-groups";
import { isHomeTab } from "./tab-model";
import { useTabTitle } from "./tab-title";
import { useNow } from "./use-now";
import { useWindowTabs } from "./window-tabs";

/** A file the person opened, as `useRecentFiles` lists it. */
type RecentFile = ReturnType<typeof useRecentFiles>["files"][number];

/**
 * Something the command menu and a new tab's box both find by name, with
 * what its row says after the name (`where`).
 */
export type SearchThing =
  | { chat: Chat; kind: "chat"; where: string | undefined }
  | { file: RecentFile; kind: "file"; where: string | undefined }
  | {
      folder: { name: string; path: string };
      kind: "folder";
      where: undefined;
    }
  | { kind: "page"; page: OfferedPage; where: string | undefined }
  | { kind: "project"; project: Project; where: undefined }
  | { kind: "tab"; tab: WindowTab; where: string | undefined };

type NamedOf<Kind extends SearchThing["kind"]> = Named<
  Extract<SearchThing, { kind: Kind }>
>;

/**
 * What the command menu and a new tab's box search by name, each kind ready
 * for `findNamed`: the tabs open in this window's groups but the one in
 * front and a new tab nobody has written in, the chats, the projects, the
 * Files sidebar's folders, the files opened lately, and the bookmarks and
 * pages visited. Pinned is what the person marked: a starred chat, a tab of
 * a pinned group, a folder pinned in the sidebar, a bookmark. Use is how
 * lately and how often each was opened (`usageOf`). Read off the disk and
 * history only while `enabled`.
 */
export function useSearchSources({ enabled }: { enabled: boolean }) {
  const shell = useShell();
  const now = useNow().getTime();
  const { bookmarkPages, recentPages, visited } = useKnownPages({ enabled });
  // Described only while asked for: each file is looked at on the disk.
  const recentFiles = useRecentFiles({ enabled }).files;
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const preferences = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const { data: chats = [] } = useQuery({
    ...chatListOptions(),
    subscribed: enabled,
  });
  const keptPaths = useAtomValue(keptPathsAtom);
  const chatTitles = new Map(chats.map((chat) => [chat.id, chat.title]));
  const { active: frontTab, allTabs } = useWindowTabs();
  // This window's groups, each as its row in the sidebar has it.
  const groups = new Map(
    useOpenGroups().open.map((entry) => [entry.group, entry]),
  );
  const titleOfTab = useTabTitle(chatTitles);

  const tabs: NamedOf<"tab">[] = allTabs.flatMap((tab) => {
    const group = tab.group === undefined ? undefined : groups.get(tab.group);
    return group === undefined || tab.id === frontTab?.id || isHomeTab(tab)
      ? []
      : [
          {
            id: `tab:${tab.id}`,
            name: titleOfTab(tab),
            pinned: group.pinned,
            value: { kind: "tab", tab, where: group.title },
          },
        ];
  });

  const chatsNamed: NamedOf<"chat">[] = chats.map((chat) => ({
    id: `chat:${chat.id}`,
    name: chat.title,
    pinned: chat.starred,
    use: usageOf({ at: chat.lastUserMessageAt }, now),
    value: {
      chat,
      kind: "chat",
      where:
        shell.projects.find((each) => each.id === chat.project)?.name ??
        (chat.archived ? "Archived" : undefined),
    },
  }));

  const projects: NamedOf<"project">[] = shell.projects
    .filter((project) => !project.retired)
    .map((project) => ({
      id: `project:${project.id}`,
      name: project.name,
      value: { kind: "project", project, where: undefined },
    }));

  // The folders the Files sidebar lists, in its order: the Instrument
  // folder, then Pinned as the person left it, then the disks and the cloud
  // services' folders.
  const sidebarPlaces = preferences.data?.sidebarPlaces ?? NO_SIDEBAR_CHANGES;
  const instrumentPlace = places.data?.pinned.find(
    (place) => place.kind === "output",
  );
  const pinnedFolders = pinnedPlaces(
    (places.data?.pinned ?? []).filter((place) => place !== instrumentPlace),
    sidebarPlaces,
    (path) => ({ name: folderNameFromPath(path), path }),
  );
  const folders: NamedOf<"folder">[] = [
    ...(instrumentPlace ? [{ isPinned: false, place: instrumentPlace }] : []),
    ...pinnedFolders.map((place) => ({ isPinned: true, place })),
    ...(places.data?.volumes ?? []).map((place) => ({
      isPinned: false,
      place,
    })),
  ].map(({ isPinned, place }) => ({
    id: `folder:${place.path}`,
    name: place.name,
    pinned: isPinned || keptPaths.has(place.path),
    value: {
      folder: { name: place.name, path: place.path },
      kind: "folder",
      where: undefined,
    },
  }));

  const files: NamedOf<"file">[] = recentFiles.map((file) => ({
    id: `file:${file.path}`,
    name: file.name,
    pinned: keptPaths.has(file.path),
    use: usageOf({ at: file.openedAt, count: file.openCount }, now),
    value: { file, kind: "file", where: folderNameOf(file.path) },
  }));

  // Bookmarks, then the pages visited. A file kept as a bookmark that the
  // files already list is left to that row.
  const visitsByUrl = new Map(visited.map((page) => [page.url, page]));
  const listedFiles = new Set(recentFiles.map((file) => file.path));
  const pages: NamedOf<"page">[] = [
    ...bookmarkPages
      .filter((page) => {
        const target = targetOfAddress(page.url);
        return !(target?.kind === "path" && listedFiles.has(target.path));
      })
      .map((page) => ({ isPinned: true, page })),
    ...recentPages.map((page) => ({ isPinned: false, page })),
  ].map(({ isPinned, page }) => {
    const visits = visitsByUrl.get(page.url);
    return {
      also: { name: bareAddress(page.url) },
      id: `page:${page.url}`,
      name: page.title || bareAddress(page.url),
      pinned: isPinned,
      use:
        visits === undefined
          ? 0
          : usageOf({ at: visits.at, count: visits.visitCount }, now),
      value: {
        kind: "page",
        page,
        where: page.title ? whereOfAddress(page.url) : undefined,
      },
    };
  });

  return {
    bookmarkPages,
    chatTitles,
    chats,
    frontTab,
    named: { chats: chatsNamed, files, folders, pages, projects, tabs },
    now,
    recentFiles,
    recentPages,
    titleOfTab,
    visited,
  };
}
