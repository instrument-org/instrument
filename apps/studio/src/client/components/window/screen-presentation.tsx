import { PlaceIcon } from "@/client/components/window/place-icons";
import { FileTypeIcon } from "@/client/components/extend/file-system";
import { debugPageTitle } from "@/client/routes/debug/-debug-routes";
import { expandHomePath, isHomeDir } from "@instrument-org/shared";
import { type ChatId, type StoreId } from "@instrument-org/workspace/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { CheckSquareIcon } from "@phosphor-icons/react/CheckSquare";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { FileTextIcon } from "@phosphor-icons/react/FileText";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { type ReactNode } from "react";

import { AppIcon } from "./app-icon";
import { osConventions } from "@/client/lib/utils";
import { FolderMark } from "./folder-mark";
import { RECENTS_ROOT } from "./computer-page";
import { joinHostPath, segmentsOf } from "./host-path";
import { locationCrumbs, type TabLocation, type Volume } from "./tab-location";
import { type ComputerTab, matchScreen, type Screen } from "./window-href";

/**
 * What an address alone cannot say about a screen: the names of the things
 * it stands for, kept by the window and read off the address's id.
 */
export interface ScreenNames {
  appsBySlug: Map<
    string,
    {
      icon?: string | undefined;
      name: string;
      site: string | undefined;
      title?: string;
    }
  >;
  /** Each chat's title by its id, for a tab standing on one; a chat not in it is a "Chat". */
  chatTitles?: Map<ChatId, string>;
  /**
   * What the home folder is called where it is not called by its own name,
   * which is to the model: the folder's name is the account name.
   */
  homeLabel?: string;
  /** Each task's title by its id, for a tab standing on one; a task not in it is a "Task". */
  taskTitles?: Map<StoreId.Session, string>;
  /** The disks the sidebar lists, which name a folder tab at the top of one. */
  volumes?: Volume[];
}

/** Where a screen tab is, in the terms the row above it says a place in. */
export function screenLocation(
  href: string,
  { appsBySlug, chatTitles, taskTitles }: ScreenNames,
): TabLocation {
  const screen = matchScreen(href);
  switch (screen.kind) {
    case "app": {
      const app = appsBySlug.get(screen.slug);
      return {
        kind: "app",
        ...(app?.icon ? { icon: app.icon } : {}),
        name: app?.title ?? app?.name ?? screen.slug,
        ...(app?.site ? { site: app.site } : {}),
      };
    }
    case "apps": {
      return { kind: "apps" };
    }
    case "chat":
    case "chatLink":
    case "chatOfSession":
    case "inbox": {
      return { kind: "chat", title: chatTitleOf(screen, chatTitles) };
    }
    case "computer": {
      if (screen.file !== undefined) {
        return {
          kind: "file",
          name: segmentsOf(screen.file).at(-1) ?? screen.file,
          path: screen.file,
        };
      }
      return { kind: "folder", path: folderPathOf(screen) };
    }
    case "task": {
      return {
        kind: "task",
        ...(screen.chat === undefined ? {} : { chat: screen.chat }),
        title: taskTitles?.get(screen.task) ?? "Task",
      };
    }
    case "tasks": {
      return {
        kind: "tasks",
        ...(screen.chat === undefined ? {} : { chat: screen.chat }),
      };
    }
    case "browser":
    case "debug":
    case "memory":
    case "namedScreen":
    case "newTab":
    case "releaseNotes":
    case "setting":
    case "site":
    case "skill":
    case "unknown": {
      // A screen the window has no words for reads as the new tab: the
      // place with nothing in particular in it.
      return { kind: "newTab" };
    }
  }
}

/** What a screen tab is called and drawn with, read off its address. */
export function screenPresentation(
  href: string,
  { appsBySlug, chatTitles, homeLabel, taskTitles, volumes }: ScreenNames,
): { icon: ReactNode; title: string } {
  const screen = matchScreen(href);
  switch (screen.kind) {
    case "app": {
      const app = appsBySlug.get(screen.slug);
      return {
        icon: app ? (
          <AppIcon name={app.name} icon={app.icon} site={app.site} size="sm" />
        ) : (
          <AppWindowIcon className="size-3.5" />
        ),
        title: app?.title ?? app?.name ?? screen.slug,
      };
    }
    case "apps": {
      return {
        icon: <PlaceIcon className="size-3.5" place="apps" />,
        title: "Apps",
      };
    }
    case "browser": {
      return {
        icon: <PlaceIcon className="size-3.5" place="browser" />,
        title: "Browser",
      };
    }
    // The plain bubble the Chats list wears: one chat is one of those.
    case "chat":
    case "chatLink":
    case "chatOfSession":
    case "inbox": {
      return {
        icon: <ChatCircleIcon className="size-3.5" />,
        title: chatTitleOf(screen, chatTitles),
      };
    }
    case "computer": {
      if (screen.file !== undefined) {
        const name = segmentsOf(screen.file).at(-1) ?? screen.file;
        return {
          icon: <FileTypeIcon className="size-4" fileName={name} />,
          title: name,
        };
      }
      return {
        icon: <FolderMark path={folderPathOf(screen)} />,
        title: folderTitle(screen, { homeLabel, volumes }),
      };
    }
    case "debug": {
      return {
        icon: <CodeIcon className="size-3.5" />,
        title: debugPageTitle(screen.pathname),
      };
    }
    case "newTab": {
      return {
        icon: <MagnifyingGlassIcon className="size-3.5" />,
        title: "New tab",
      };
    }
    case "releaseNotes": {
      return {
        icon: <FileTextIcon className="size-3.5" />,
        title: "Release notes",
      };
    }
    // One task, a single box of the mark the chat's menu opens the list with.
    case "task": {
      return {
        icon: <CheckSquareIcon className="size-3.5" />,
        title: taskTitles?.get(screen.task) ?? "Task",
      };
    }
    case "tasks": {
      return { icon: <ListChecksIcon className="size-3.5" />, title: "Tasks" };
    }
    case "memory":
    case "namedScreen":
    case "setting":
    case "site":
    case "skill":
    case "unknown": {
      return {
        icon: <MagnifyingGlassIcon className="size-3.5" />,
        title: "Tab",
      };
    }
  }
}

/** The chat a screen address stands on, by the title the window has for it. */
function chatTitleOf(
  screen: Extract<
    Screen,
    { kind: "chat" | "chatLink" | "chatOfSession" | "inbox" }
  >,
  chatTitles: ScreenNames["chatTitles"],
) {
  return (
    (screen.kind === "chat" ? chatTitles?.get(screen.chat) : undefined) ??
    "Chat"
  );
}

/**
 * The folder a folder tab's address stands in: the root the browser is rooted
 * at, and the walk below it, as one path. The home folder stays `~`, which is
 * how the row writes it; the recents are no folder at all.
 */
function folderPathOf({ path, root }: ComputerTab) {
  return root === RECENTS_ROOT ? "" : joinHostPath(root, path);
}

/**
 * What a folder tab is called: the last name the location bar says for it, so
 * the tab and the bar never name the place two ways. The top of a disk is the
 * disk's name once the disks are known, and the computer until then.
 */
function folderTitle(
  tab: ComputerTab,
  { homeLabel, volumes }: Pick<ScreenNames, "homeLabel" | "volumes">,
) {
  if (tab.root === RECENTS_ROOT) {
    return "Recents";
  }
  const home = window.api.homeDir;
  const path = folderPathOf(tab);
  if (homeLabel !== undefined && isHomeDir(expandHomePath(path, home), home)) {
    return homeLabel;
  }
  const crumbs = locationCrumbs(
    { kind: "folder", path },
    { home, ...(volumes ? { volumes } : {}) },
  );
  return crumbs.at(-1)?.label ?? osConventions().computer;
}
