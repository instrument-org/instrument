import { type WindowTab } from "@/client/atoms/window";
import { targetOfAddress } from "@/client/bookmarks/address";
import { bookmarkedChatsAtom, keptPathsAtom } from "@/client/bookmarks/store";
import { useRecentFiles } from "@/client/hooks/use-recent-files";
import { rpcClient } from "@/client/rpc/client";
import { NO_FAVORITE_CHANGES, favoritePlaces } from "@/shared/favorite-places";
import { folderNameFromPath, instrumentLinkOf } from "@instrument-org/shared";
import { type ChatId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";

import { chatListOptions } from "./chat-list-query";
import { type Chat, type Project } from "./chats";
import { useKnownPages } from "./known-pages";
import { type Named, usageOf } from "./name-search";
import { bareAddress, folderNameOf, type OfferedPage } from "./omnibar-match";
import { whereOfAddress } from "./row-text";
import { useShell } from "./shell-context";
import { type OpenGroupRow, useOpenGroupRows } from "./open-group-rows";
import { chatOfTab, isHomeTab } from "./tab-model";
import { useTabTitle } from "./tab-title";
import { useMinuteClock } from "./use-minute-clock";
import { matchScreen } from "./window-href";
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
      where: string | undefined;
    }
  | { kind: "group"; row: OpenGroupRow; where: undefined }
  | { kind: "page"; page: OfferedPage; where: string | undefined }
  | { kind: "project"; project: Project; where: undefined }
  | { kind: "tab"; tab: WindowTab; where: string | undefined };

type NamedOf<Kind extends SearchThing["kind"]> = Named<
  Extract<SearchThing, { kind: Kind }>
>;

/**
 * What the command menu and a new tab's box search by name, each kind ready
 * for `findNamed`: this window's tab groups but the ones of blank new tabs
 * and the one that goes by a page or file in front,
 * the tabs open in them but the one in front, a new tab nobody has written
 * in, the one its group goes by, and a chat's, which the chat's own row goes
 * to, the chats but the ones a group goes by, the projects, the
 * Files sidebar's folders, the files opened lately, and the bookmarks and
 * pages visited, but the ones an open tab is on. Pinned is what the person marked: a bookmarked chat, a pinned group
 * and its tabs, a folder in the sidebar's Favorites, a bookmark. Use is how
 * lately and how often each was opened (`usageOf`). Read off the disk and
 * history only while `enabled`.
 */
export function useSearchSources({ enabled }: { enabled: boolean }) {
  const shell = useShell();
  const now = useMinuteClock().getTime();
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
  const groupRows = useOpenGroupRows({
    chatTitles,
    enabled,
    projects: shell.projects,
  });
  const groupRowOf = new Map(groupRows.map((row) => [row.entry.group, row]));
  const titleOfTab = useTabTitle(chatTitles);

  const visitsByUrl = new Map(visited.map((page) => [page.url, page]));
  const filesByPath = new Map(recentFiles.map((file) => [file.path, file]));
  const bookmarkedUrls = new Set(bookmarkPages.map((page) => page.url));
  const bookmarkedChats = useAtomValue(bookmarkedChatsAtom);
  // A tab showing a page or a file is as pinned and as used as what it
  // shows, and stands for it: the page or file has no row of its own while
  // a tab listed here shows it.
  const shownUrls = new Set<string>();
  const shownPaths = new Set<string>();
  // What a tab shows, and how it is pinned and used for it.
  const standingOf = (tab: WindowTab) => {
    const url = tab.kind === "page" ? tab.url : undefined;
    const screen = tab.kind === "screen" ? matchScreen(tab.href) : undefined;
    const path = screen?.kind === "computer" ? screen.file : undefined;
    const visits = url === undefined ? undefined : visitsByUrl.get(url);
    const file = path === undefined ? undefined : filesByPath.get(path);
    return {
      path,
      pinned:
        (url !== undefined && bookmarkedUrls.has(url)) ||
        (path !== undefined && keptPaths.has(path)),
      url,
      use: visits
        ? usageOf({ at: visits.at, count: visits.visitCount }, now)
        : file
          ? usageOf({ at: file.openedAt, count: file.openCount }, now)
          : 0,
    };
  };
  const tabs: NamedOf<"tab">[] = allTabs.flatMap((tab) => {
    const row = tab.group === undefined ? undefined : groupRowOf.get(tab.group);
    if (row === undefined || isHomeTab(tab) || chatOfTab(tab) !== undefined) {
      return [];
    }
    const standing = standingOf(tab);
    if (standing.url !== undefined) {
      shownUrls.add(standing.url);
    }
    if (standing.path !== undefined) {
      shownPaths.add(standing.path);
    }
    // The group's row goes to the tab it goes by, and the one in front has
    // nowhere to go to.
    if (tab.id === row.lead.id || tab.id === frontTab?.id) {
      return [];
    }
    return [
      {
        id: `tab:${tab.id}`,
        name: titleOfTab(tab),
        pinned: row.entry.pinned || standing.pinned,
        use: standing.use,
        value: { kind: "tab", tab, where: row.name },
      },
    ];
  });

  // A group that goes by a chat is remembered as that chat, so a pick of the
  // chat holds whether or not its group is open.
  const chatsLeading = new Set<ChatId>();
  const groups: NamedOf<"group">[] = groupRows.flatMap((row) => {
    if (row.isBlank) {
      return [];
    }
    // Like the tab in front, a group that goes by it has nowhere to go to.
    if (row.chat === undefined && row.lead.id === frontTab?.id) {
      return [];
    }
    const chat =
      row.chat === undefined || chatsLeading.has(row.chat)
        ? undefined
        : chats.find((each) => each.id === row.chat);
    if (chat) {
      chatsLeading.add(chat.id);
    }
    const standing = standingOf(row.lead);
    return [
      {
        id: chat ? `chat:${chat.id}` : `group:${row.entry.group}`,
        name: row.name,
        pinned:
          row.entry.pinned ||
          (chat ? bookmarkedChats.has(chat.id) : standing.pinned),
        use: chat ? usageOf({ at: chat.lastUserMessageAt }, now) : standing.use,
        value: { kind: "group", row, where: undefined },
      },
    ];
  });

  const chatsNamed: NamedOf<"chat">[] = chats
    .filter((chat) => !chatsLeading.has(chat.id))
    .map((chat) => ({
      id: `chat:${chat.id}`,
      name: chat.title,
      pinned: bookmarkedChats.has(chat.id),
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
  // folder, then Favorites as the person left it, then the disks and the cloud
  // services' folders.
  const favoriteChanges =
    preferences.data?.favoriteChanges ?? NO_FAVORITE_CHANGES;
  const instrumentPlace = places.data?.favorites.find(
    (place) => place.kind === "output",
  );
  const favoriteFolders = favoritePlaces(
    (places.data?.favorites ?? []).filter((place) => place !== instrumentPlace),
    favoriteChanges,
    (path) => ({ name: folderNameFromPath(path), path }),
  );
  const listedFolders = [
    ...(instrumentPlace ? [{ isPinned: false, place: instrumentPlace }] : []),
    ...favoriteFolders.map((place) => ({ isPinned: true, place })),
    ...(places.data?.volumes ?? []).map((place) => ({
      isPinned: false,
      place,
    })),
  ];
  // Two folders of one name each say which folder they are in.
  const folderNames = listedFolders.map(({ place }) => place.name);
  const folders: NamedOf<"folder">[] = listedFolders.map(
    ({ isPinned, place }) => ({
      id: `folder:${place.path}`,
      name: place.name,
      pinned: isPinned || keptPaths.has(place.path),
      value: {
        folder: { name: place.name, path: place.path },
        kind: "folder",
        where:
          folderNames.indexOf(place.name) ===
          folderNames.lastIndexOf(place.name)
            ? undefined
            : folderNameOf(place.path),
      },
    }),
  );

  const files: NamedOf<"file">[] = recentFiles
    .filter((file) => !shownPaths.has(file.path))
    .map((file) => ({
      id: `file:${file.path}`,
      name: file.name,
      pinned: keptPaths.has(file.path),
      use: usageOf({ at: file.openedAt, count: file.openCount }, now),
      value: { file, kind: "file", where: folderNameOf(file.path) },
    }));

  // Bookmarks, then the pages visited. A file or a chat kept as a bookmark
  // that the files or the chats already list is left to that row.
  const listedFiles = new Set(recentFiles.map((file) => file.path));
  const listedChats = new Set<string>(chats.map((chat) => chat.id));
  const pages: NamedOf<"page">[] = [
    ...bookmarkPages
      .filter((page) => {
        const target = targetOfAddress(page.url);
        const link = instrumentLinkOf(page.url);
        return !(
          (target?.kind === "path" && listedFiles.has(target.path)) ||
          (link?.kind === "chat" && listedChats.has(link.name))
        );
      })
      .map((page) => ({ isPinned: true, page })),
    ...recentPages.map((page) => ({ isPinned: false, page })),
  ]
    .filter(({ page }) => !shownUrls.has(page.url))
    .map(({ isPinned, page }) => {
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
    groupRows,
    named: { chats: chatsNamed, files, folders, groups, pages, projects, tabs },
    now,
    recentFiles,
    recentPages,
    titleOfTab,
    visited,
  };
}
