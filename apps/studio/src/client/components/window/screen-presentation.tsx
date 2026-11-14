import {
  type Show,
  SHOW_LABELS,
  SHOWS,
} from "@/client/components/activity/activity-timeline";
import { PlaceIcon } from "@/client/components/window/place-icons";
import { debugPageTitle } from "@/client/routes/debug/-debug-routes";
import {
  type ScreenName,
  SCREENS,
  SETTINGS_SECTIONS,
  screenOfHref,
} from "@/shared/instrument-screens";
import { type ChatId, type StoreId } from "@instrument-org/workspace/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { CheckSquareIcon } from "@phosphor-icons/react/CheckSquare";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { type ReactNode } from "react";

import { ScreenMark } from "./app-chip";
import { AppIcon } from "./app-icon";
import { osConventions } from "@/client/lib/utils";
import { COMPUTER_ROOT } from "@/shared/computer-href";
import { FileMark } from "./file-mark";
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
  /** The titles pages give themselves by host path, for a tab standing on one; a page not in it goes by its file name. */
  fileTitles?: Map<string, string>;
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
    case "chatOfSession": {
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
        ...(screen.chat === undefined
          ? {}
          : {
              chat: {
                id: screen.chat,
                title: chatTitles?.get(screen.chat) ?? "Chat",
              },
            }),
        kind: "task",
        title: taskTitles?.get(screen.task) ?? "Task",
      };
    }
    // The chat with no chat open is a new chat, written into its draft.
    case "inbox": {
      return { kind: "newChat" };
    }
    // Every chat, which is Chat's own index.
    case "history": {
      return screen.chats
        ? { kind: "chats" }
        : { kind: "builtin", screen: "history" };
    }
    // What Activity shows, when it is one kind of row, is the part it is at,
    // and the row open inside it says itself (`TabSurface.item`).
    case "activity": {
      const show = activityShowOf(href);
      return {
        kind: "builtin",
        ...(show
          ? {
              part: SHOW_LABELS[show].label,
              partHref: `${SCREENS.activity.href}?show=${show}`,
            }
          : {}),
        screen: "activity",
      };
    }
    // A built-in page, by its name in `SCREENS`, and the part of Settings
    // shown by its title.
    case "browser":
    case "extensions":
    case "memories":
    case "releaseNotes":
    case "settings":
    case "skills": {
      const part = screenOfHref(href)?.part;
      return {
        kind: "builtin",
        ...(part ? { part: SETTINGS_SECTIONS[part] } : {}),
        screen: SCREEN_OF_KIND[screen.kind],
      };
    }
    case "debug":
    case "group":
    case "memory":
    case "namedScreen":
    case "newTab":
    case "project":
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
  { appsBySlug, chatTitles, fileTitles, taskTitles, volumes }: ScreenNames,
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
          icon: (
            <FileMark className="size-4" hostPath={screen.file} name={name} />
          ),
          title: fileTitles?.get(screen.file) ?? name,
        };
      }
      return {
        icon: <FolderMark path={folderPathOf(screen)} />,
        title: folderTitle(screen, { volumes }),
      };
    }
    case "group": {
      return {
        icon: <ChatCircleIcon className="size-3.5" />,
        title: "Tab group",
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
        title: "New Tab",
      };
    }
    // History, or the index of every chat under a list mark of its own.
    case "history": {
      const name = screen.chats ? "chats" : "history";
      return {
        icon: <ScreenMark className="size-3.5" name={name} />,
        title: SCREENS[name].title,
      };
    }
    // A built-in page by its own name and mark; one Settings tab whichever
    // part it is at, which the address field says.
    case "activity":
    case "extensions":
    case "memories":
    case "releaseNotes":
    case "settings":
    case "skills": {
      const name = SCREEN_OF_KIND[screen.kind];
      return {
        icon: <ScreenMark className="size-3.5" name={name} />,
        title: SCREENS[name].title,
      };
    }
    // One task, a single box of the mark the chat's menu opens the list with.
    case "task": {
      return {
        icon: <CheckSquareIcon className="size-3.5" />,
        title: taskTitles?.get(screen.task) ?? "Task",
      };
    }
    case "memory":
    case "namedScreen":
    case "project":
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

/** The one kind of row Activity's address shows, if it names one. */
function activityShowOf(href: string): Show | undefined {
  let show: null | string;
  try {
    show = new URL(href, "http://tabs").searchParams.get("show");
  } catch {
    return undefined;
  }
  return SHOWS.find((each) => each === show);
}

/** The built-in page each of the window's own screen kinds is, by its name in `SCREENS`. */
const SCREEN_OF_KIND = {
  activity: "activity",
  browser: "browser",
  extensions: "extensions",
  history: "history",
  memories: "memory",
  releaseNotes: "release-notes",
  settings: "settings",
  skills: "skills",
} as const satisfies Partial<Record<Screen["kind"], ScreenName>>;

/**
 * The chat a screen address stands on, by the title the window has for it,
 * and a new chat as the new tab it is until something is sent from it.
 */
function chatTitleOf(
  screen: Extract<
    Screen,
    { kind: "chat" | "chatLink" | "chatOfSession" | "inbox" }
  >,
  chatTitles: ScreenNames["chatTitles"],
) {
  if (screen.kind === "inbox") {
    return "New Tab";
  }
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
  if (root === COMPUTER_ROOT) {
    return COMPUTER_ROOT;
  }
  return root === RECENTS_ROOT ? "" : joinHostPath(root, path);
}

/**
 * What a folder tab is called: the last name the location bar says for it, so
 * the tab and the bar never name the place two ways. The top of a disk is the
 * disk's name once the disks are known, and the computer until then.
 */
function folderTitle(
  tab: ComputerTab,
  { volumes }: Pick<ScreenNames, "volumes">,
) {
  if (tab.root === RECENTS_ROOT) {
    return "Recents";
  }
  if (tab.root === COMPUTER_ROOT) {
    return osConventions().computer;
  }
  const home = window.api.homeDir;
  const path = folderPathOf(tab);
  const crumbs = locationCrumbs(
    { kind: "folder", path },
    { home, ...(volumes ? { volumes } : {}) },
  );
  return crumbs.at(-1)?.label ?? osConventions().computer;
}
