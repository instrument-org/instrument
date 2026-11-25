import { SHOW_LABELS } from "@/client/components/activity/activity-timeline";
import { type Show, SHOWS } from "@/shared/history-show";
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
import { NotePencilIcon } from "@phosphor-icons/react/NotePencil";
import { CheckSquareIcon } from "@phosphor-icons/react/CheckSquare";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { LinkBreakIcon } from "@phosphor-icons/react/LinkBreak";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { stripMarkdown } from "@instrument-org/shared/strip-markdown";
import { type ReactNode } from "react";

import { ScreenMark } from "./app-chip";
import { AppIcon } from "./app-icon";
import { osConventions } from "@/client/lib/utils";
import { COMPUTER_ROOT } from "@/shared/computer-href";
import { debugAddressOf } from "./debug-address";
import { FileMark } from "./file-mark";
import { FolderMark } from "./folder-mark";
import { RECENTS_ROOT } from "./computer-page";
import { joinHostPath, segmentsOf } from "./host-path";
import { askedAddressOf } from "./missing-page";
import { ProjectMark, type ProjectMarkSpec } from "./project-mark";
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
  /** The projects in use by id, for a tab standing on one; one not in it is every chat. */
  projects?: ReadonlyMap<string, ProjectMarkSpec & { name: string }>;
  /** Each task's title by its id, for a tab standing on one; a task not in it is a "Task". */
  taskTitles?: Map<StoreId.Session, string>;
  /** The disks the sidebar lists, which name a folder tab at the top of one. */
  volumes?: Volume[];
}

/** What a screen is called, drawn with, and where it is, read off its address. */
export interface ScreenIdentity {
  icon: ReactNode;
  /** Where it is, in the terms the row above it says a place in. */
  location: TabLocation;
  title: string;
}

/**
 * Every screen's identity, by its kind, in one table: what its tab, its
 * sidebar row, a chip, History and the agent call it, its mark, and where
 * the location bar says it is. Where the title and the place differ on
 * purpose, the case says why.
 */
export function screenIdentity(
  href: string,
  {
    appsBySlug,
    chatTitles,
    fileTitles,
    projects,
    taskTitles,
    volumes,
  }: ScreenNames,
): ScreenIdentity {
  const screen = matchScreen(href);
  switch (screen.kind) {
    case "app": {
      const app = appsBySlug.get(screen.slug);
      const name = app?.title ?? app?.name ?? screen.slug;
      return {
        icon: app ? (
          <AppIcon name={app.name} icon={app.icon} site={app.site} size="sm" />
        ) : (
          <AppWindowIcon className="size-3.5" />
        ),
        location: {
          kind: "app",
          ...(app?.icon ? { icon: app.icon } : {}),
          name,
          ...(app?.site ? { site: app.site } : {}),
        },
        title: name,
      };
    }
    case "apps": {
      return {
        icon: <PlaceIcon className="size-3.5" place="apps" />,
        location: { kind: "apps" },
        title: "Apps",
      };
    }
    // The plain bubble the Chats list wears: one chat is one of those.
    case "chat":
    case "chatLink":
    case "chatOfSession": {
      const title = chatTitleOf(screen, chatTitles);
      return {
        icon: <ChatCircleIcon className="size-3.5" />,
        location: { kind: "chat", title },
        title,
      };
    }
    // A new tab is a chat about to start, marked as one being written, in
    // its strip tab and its sidebar row alike. Its tab is the New Tab, and the
    // place it is at is a new chat, which the location bar writes into.
    case "inbox": {
      return {
        icon: <NotePencilIcon className="size-3.5" />,
        location: { kind: "newChat" },
        title: "New Tab",
      };
    }
    case "computer": {
      if (screen.file !== undefined) {
        const name = segmentsOf(screen.file).at(-1) ?? screen.file;
        return {
          icon: (
            <FileMark className="size-4" hostPath={screen.file} name={name} />
          ),
          location: { kind: "file", name, path: screen.file },
          title: fileTitles?.get(screen.file) ?? name,
        };
      }
      return {
        icon: <FolderMark path={folderPathOf(screen)} />,
        location: { kind: "folder", path: folderPathOf(screen) },
        title: folderTitle(screen, { volumes }),
      };
    }
    case "task": {
      const chatTitle =
        screen.chat === undefined ? undefined : chatTitles?.get(screen.chat);
      const title = taskTitles?.get(screen.task) ?? "Task";
      return {
        // One task, a single box of the mark the chat's menu opens the list with.
        icon: <CheckSquareIcon className="size-3.5" />,
        location: {
          ...(screen.chat === undefined
            ? {}
            : {
                chat: {
                  id: screen.chat,
                  title:
                    chatTitle === undefined ? "Chat" : stripMarkdown(chatTitle),
                },
              }),
          kind: "task",
          title,
        },
        title,
      };
    }
    // Every chat, which is Chat's own index, or one project's by its own
    // name and mark.
    case "chats": {
      const project = projectOf(screen, projects);
      return project
        ? {
            icon: <ProjectMark project={project} size="sm" />,
            location: { kind: "chats", project },
            title: project.name,
          }
        : {
            icon: <ScreenMark className="size-3.5" name="chats" />,
            location: { kind: "chats" },
            title: SCREENS.chats.title,
          };
    }
    // A built-in page by its own name and mark; one tab whichever part of it
    // is up (a kind of History's rows, a section of Settings), which the
    // location bar says.
    case "activity":
    case "bookmarks":
    case "browser":
    case "extensions":
    case "releaseNotes":
    case "settings": {
      const name = SCREEN_OF_KIND[screen.kind];
      const show =
        screen.kind === "activity" ? activityShowOf(href) : undefined;
      const section = screenOfHref(href)?.part;
      const part = show
        ? SHOW_LABELS[show]
        : section
          ? SETTINGS_SECTIONS[section]
          : undefined;
      return {
        icon:
          screen.kind === "browser" ? (
            <PlaceIcon className="size-3.5" place="browser" />
          ) : (
            <ScreenMark className="size-3.5" name={name} />
          ),
        location: {
          kind: "builtin",
          ...(part ? { part } : {}),
          screen: name,
        },
        title: SCREENS[name].title,
      };
    }
    // A debug page says its own address, which the field takes back.
    case "debug": {
      return {
        icon: <CodeIcon className="size-3.5" />,
        location: { address: debugAddressOf(href) ?? href, kind: "debug" },
        title: debugPageTitle(screen.pathname),
      };
    }
    // A tab group's own address, before the window turns it into the group.
    case "group": {
      return {
        icon: <ChatCircleIcon className="size-3.5" />,
        location: { kind: "newTab" },
        title: "Tab group",
      };
    }
    // A screen the window has no words for reads as the new tab: the place
    // with nothing in particular in it.
    case "memory":
    case "namedScreen":
    case "project":
    case "setting":
    case "site":
    case "skill":
    case "tabGroup":
    case "windowTab": {
      return {
        icon: <MagnifyingGlassIcon className="size-3.5" />,
        location: { kind: "newTab" },
        title: "Tab",
      };
    }
    // A page that doesn't exist is at the address it was asked for.
    case "unknown": {
      return {
        icon: <LinkBreakIcon className="size-3.5" />,
        location: { address: askedAddressOf(href), kind: "missing" },
        title: "Page not found",
      };
    }
  }
}

/** The project the address of a list of chats stands in, when it is one in use. */
function projectOf(
  screen: Extract<Screen, { kind: "chats" }>,
  projects: ScreenNames["projects"],
) {
  return screen.project === undefined
    ? undefined
    : projects?.get(screen.project);
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
  bookmarks: "bookmarks",
  browser: "browser",
  extensions: "extensions",
  releaseNotes: "release-notes",
  settings: "settings",
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
  const title =
    screen.kind === "chat" ? chatTitles?.get(screen.chat) : undefined;
  return title === undefined ? "Chat" : stripMarkdown(title);
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
