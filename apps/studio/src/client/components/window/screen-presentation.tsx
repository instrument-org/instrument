import { PlaceIcon } from "@/client/components/window/place-icons";
import { screenNameOfHref } from "@/client/bookmarks/address";
import { SCREENS, type ScreenName } from "@/shared/instrument-screens";
import { debugPageTitle } from "@/client/routes/debug/-debug-routes";
import { type ScreenName, SCREENS } from "@/shared/instrument-screens";
import { type ChatId, type StoreId } from "@instrument-org/workspace/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { CheckSquareIcon } from "@phosphor-icons/react/CheckSquare";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { CubeIcon } from "@phosphor-icons/react/Cube";
import { FileTextIcon } from "@phosphor-icons/react/FileText";
import { FingerprintIcon } from "@phosphor-icons/react/Fingerprint";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { KeyboardIcon } from "@phosphor-icons/react/Keyboard";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PulseIcon } from "@phosphor-icons/react/Pulse";
import { PuzzlePieceIcon } from "@phosphor-icons/react/PuzzlePiece";
import { ShapesIcon } from "@phosphor-icons/react/Shapes";
import { type ElementType, type ReactNode } from "react";

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
 * The mark of each built-in page, by its name in `SCREENS`: what its tab,
 * its address field and a chip for it are drawn with, the places' own
 * (`PLACE_ICONS`) for Apps, the browser and Files. History keeps the
 * clock a browser's history wears, so Activity, the other record of the
 * past, wears the pulse Settings gives it.
 */
const SCREEN_ICONS: Record<ScreenName, ElementType> = {
  activity: PulseIcon,
  apps: ShapesIcon,
  browser: GlobeIcon,
  extensions: PuzzlePieceIcon,
  files: FolderSimpleIcon,
  history: ClockCounterClockwiseIcon,
  memory: FingerprintIcon,
  "release-notes": FileTextIcon,
  settings: GearSixIcon,
  shortcuts: KeyboardIcon,
  skills: CubeIcon,
};

/** A built-in page's mark, at the size a tab's is. */
export function ScreenIcon({
  className = "size-3.5",
  name,
}: {
  className?: string;
  name: ScreenName;
}) {
  const Icon = SCREEN_ICONS[name];
  return <Icon className={className} />;
}

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
        kind: "task",
        title: taskTitles?.get(screen.task) ?? "Task",
      };
    }
    case "extensions": {
      return { kind: "screen", screen: "extensions" };
    }
    // The chat with no chat open is a new chat, written into its draft.
    case "inbox": {
      return { kind: "newChat" };
    }
    case "activity":
    case "history":
    case "memories":
    case "skills": {
      return { kind: "screen", screen: SCREEN_OF_KIND[screen.kind] };
    }
    case "settings": {
      return {
        kind: "screen",
        ...(screen.section ? { part: screen.section } : {}),
        screen: "settings",
      };
    }
    case "browser":
    case "debug":
    case "memory":
    case "namedScreen":
    case "newTab":
    case "project":
    case "releaseNotes":
    case "setting":
    case "site":
    case "skill":
    case "unknown": {
      // A built-in page of the table, by its own href or a part under it;
      // a screen the window has no words for reads as the new tab: the
      // place with nothing in particular in it.
      const builtin = screenNameOfHref(href);
      return builtin === undefined
        ? { kind: "newTab" }
        : { kind: "builtin", ...builtinPart(href, builtin), screen: builtin };
    }
  }
}

/**
 * The part of a built-in page an address stands at, read off what follows
 * the page's own href (`/settings/models` is Models), where it has parts.
 */
function builtinPart(href: string, name: ScreenName): { part?: string } {
  const own = SCREENS[name];
  if (!("href" in own)) {
    return {};
  }
  const pathname = new URL(href, "http://tabs").pathname;
  const below = pathname.slice(own.href.length).split("/").find(Boolean);
  if (below === undefined) {
    return {};
  }
  let words = below;
  try {
    words = decodeURIComponent(below);
  } catch {
    // Taken as written.
  }
  words = words.replaceAll(/[-_]+/g, " ");
  return { part: words.charAt(0).toUpperCase() + words.slice(1) };
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
    case "activity":
    case "history":
    case "memories":
    case "skills": {
      const name = SCREEN_OF_KIND[screen.kind];
      return {
        icon: <ScreenIcon name={name} />,
        title: SCREENS[name].title,
      };
    }
    // One Settings tab, whichever part it is at; the address field says the part.
    case "settings": {
      return {
        icon: <ScreenIcon name="settings" />,
        title: SCREENS.settings.title,
      };
    }
    case "extensions": {
      return {
        icon: <PuzzlePieceIcon className="size-3.5" />,
        title: "Extensions",
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

/** The built-in page each of the window's own screen kinds is, by its name in `SCREENS`. */
const SCREEN_OF_KIND = {
  activity: "activity",
  history: "history",
  memories: "memory",
  skills: "skills",
} as const satisfies Partial<Record<Screen["kind"], ScreenName>>;

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
