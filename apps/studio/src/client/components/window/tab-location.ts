import { type OpenTarget } from "@/client/lib/open-target";
import { osConventions } from "@/client/lib/utils";
import { COMPUTER_ROOT, folderHref } from "@/shared/computer-href";
import { type ScreenName } from "@/shared/instrument-screens";
import { expandHomePath, namesFromHome } from "@instrument-org/shared";
import {
  type ChatId,
  ChatIdSchema,
  type StoreId,
} from "@instrument-org/workspace/client";

import type { BuiltInApp } from "./app-chip";
import { type ProjectMarkSpec } from "./project-mark";
import { isInside, segmentsOf, separatorOf } from "./host-path";
import {
  chatHref,
  LINK_ADDRESSES,
  matchScreen,
  pathOf,
  SCREEN_ROUTES,
} from "./window-href";

/** One part of the place the field shows. */
export interface LocationCrumb {
  /** What it says: a name along a path, or the screen the place sits under. */
  label: string;
  /** Where a press on it goes; absent on the last, which is where the tab is. */
  to?: OpenTarget;
  /** The folder it names, or the file for the last part of a file's path, for a path on the computer. */
  path?: string;
}

/** A disk or a cloud service's folder, by the name the sidebar lists it under. */
export interface Volume {
  name: string;
  path: string;
}

/**
 * The address of one task's page: its session, and the chat whose store
 * holds it.
 */
export function taskHref(id: StoreId.Session, chat: ChatId): string {
  return `${pathOf(SCREEN_ROUTES.task, { sessionId: id })}?chat=${chat}`;
}

/** The chat a task's address names; none for no chat or one that is not a chat's id. */
export function chatOfTaskAddress(chat: unknown): ChatId | undefined {
  const parsed = ChatIdSchema.safeParse(chat);
  return parsed.success ? parsed.data : undefined;
}

/** The address of one memory, by its name. */
export function memoryHref(name: string): string {
  return pathOf(LINK_ADDRESSES.memory, { name });
}

/** The address of one skill, by the name a task loads it by. */
export function skillHref(name: string): string {
  return pathOf(LINK_ADDRESSES.skill, { name });
}

/** What the tab on screen is showing, in the terms that page has for itself. */
export type TabLocation =
  | {
      /** Shown as a page in a guest rather than in a viewer, so its source is the other way to look at it. */
      asPage?: boolean;
      kind: "file";
      name: string;
      /** Where the file sits on the computer, which makes the folders above it places the tab can go. */
      path: string;
    }
  | {
      /** The chat the task was started in, which its crumb goes back to. */
      chat?: { id: ChatId; title: string };
      kind: "task";
      title: string;
    }
  | { icon?: string; kind: "app"; name: string; site?: string }
  | { kind: "apps" }
  /**
   * A built-in page of the app, by its name in `SCREENS` (Settings,
   * Memory, Skills, Chats, Activity, the browser's extensions): the part
   * of it shown where it has parts (a part of Settings, what History is
   * showing), by the name the field reads it by.
   */
  | {
      kind: "builtin";
      part?: string;
      screen: ScreenName;
    }
  | { kind: "chat"; title: string }
  /** A debug page, at the address the field shows and takes (`debugAddressOf`). */
  | { address: string; kind: "debug" }
  /** A page that doesn't exist, at the address it was asked for (`askedAddressOf`). */
  | { address: string; kind: "missing" }
  /** Every chat, open or not: the index Chat's chip goes to; or one project's. */
  | { kind: "chats"; project?: ProjectMarkSpec & { name: string } }
  /**
   * A chat not started yet: a new tab, which is nowhere yet. It becomes the
   * chat once something is sent from it, or the page or file put in it.
   */
  | { kind: "newChat" }
  | {
      /** Where the folder really is, when that is not where it was walked to: an iCloud Drive app folder. */
      hostPath?: string;
      kind: "folder";
      path: string;
      /** How many are picked in it, when that is several and they stand in for a file open beside it: the place is then them. A path of "" is the recents, which are in no one folder. */
      picked?: number;
      /** The one item selected in the folder, by host path, which the system's file manager shows selected when the folder is handed to it. */
      selected?: string;
    }
  | { kind: "newTab" }
  | { kind: "page"; url: string };

/**
 * The place the field shows, as the parts a person reads it in.
 *
 * One rule everywhere: the last part is what you are looking at, and everything
 * the place sits under is somewhere you can go. A file is under its folders, an
 * app page under Apps. An address is not one of these:
 * a site is one thing you type rather than a trail you walk, so a page has no
 * parts and the field says it whole.
 */
export function locationCrumbs(
  location: TabLocation,
  { home, volumes = [] }: { home: string; volumes?: Volume[] },
): LocationCrumb[] {
  switch (location.kind) {
    // An app's page is under Apps, which the field's chip says, and Apps
    // itself is the chip alone.
    case "app": {
      return [{ label: location.name }];
    }
    case "apps": {
      return [];
    }
    case "builtin": {
      return location.part === undefined ? [] : [{ label: location.part }];
    }
    // A chat hangs from the chat beside the tabs rather than from a screen
    // under one, so there is nothing above it the field could go to.
    case "chat": {
      return [{ label: location.title }];
    }
    // A path reads the same whichever screen said it: the folder browser
    // hands over a path with the home folder as `~`, and a file arrives as it
    // sits on the disk.
    case "file": {
      return pathCrumbs(location.path, { home, volumes });
    }
    // Several picked are the place, under the folder they are in.
    case "folder": {
      if (location.path === COMPUTER_ROOT) {
        return [{ label: osConventions().computer }];
      }
      if (location.picked === undefined) {
        return pathCrumbs(location.path, { home, volumes });
      }
      const count = { label: `${location.picked} items` };
      return location.path === ""
        ? [count]
        : [
            ...pathCrumbs(location.path, { home, linksLast: true, volumes }),
            count,
          ];
    }
    // A project is under every chat, which the field's chip says, and every
    // chat is the chip alone.
    case "chats": {
      return location.project === undefined
        ? []
        : [{ label: location.project.name }];
    }
    case "debug":
    case "missing":
    case "newChat":
    case "newTab":
    case "page": {
      return [];
    }
    // A task is under the chat it was started in, which the crumb goes
    // back to.
    case "task": {
      return [
        ...(location.chat === undefined
          ? []
          : [
              {
                label: location.chat.title,
                to: {
                  href: chatHref(location.chat.id),
                  kind: "screen" as const,
                },
              },
            ]),
        { label: location.title },
      ];
    }
  }
}

/**
 * Which of the app's own apps a location is in, whose chip leads the field:
 * Chat for a chat, a task and the index of chats, Files for a file or a folder, Apps for an
 * app's page, and each built-in page its own. A website, a debug page, a
 * page that doesn't exist and a new tab, a new chat among them, have none.
 */
export function locationChip(location: TabLocation): BuiltInApp | undefined {
  switch (location.kind) {
    case "app":
    case "apps": {
      return "apps";
    }
    case "builtin": {
      return location.screen;
    }
    case "chat":
    case "chats":
    case "task": {
      return "chat";
    }
    case "file":
    case "folder": {
      return "files";
    }
    case "debug":
    case "missing":
    case "newChat":
    case "newTab":
    case "page": {
      return undefined;
    }
  }
}

/**
 * The task an address names, by its session, and the chat it is in when the
 * address carries one. Nothing for any other address, and nothing for an id
 * that is not one.
 */
export function tasksOfHref(
  href: string,
): undefined | { chat?: ChatId; task: StoreId.Session } {
  const screen = matchScreen(href);
  if (screen.kind !== "task") {
    return undefined;
  }
  const { kind: _tasks, ...tasks } = screen;
  return tasks;
}

/** A name that is a whole volume on Windows, which is where a path there starts. */
function isDrive(name: string) {
  return /^[a-z]:$/i.test(name);
}

/** The path a name goes on the end of, however the one it goes on ends. */
function join(base: string, name: string, separator: string) {
  return base.endsWith(separator)
    ? `${base}${name}`
    : `${base}${separator}${name}`;
}

/**
 * A path as its names, each above the last a way to that folder.
 *
 * A path in the home folder starts at that folder, called by its own name the
 * way the file manager calls it, rather than at the disk or at `~`. Anywhere
 * else it starts at the disk it is on, by the disk's name, so the top of the
 * boot disk is "Macintosh HD" rather than nothing at all. Where a name goes is
 * the path the computer knows, so `~` is written out there. A path that names
 * no place on the computer -- a prefix under a root -- is names alone with
 * nowhere to go.
 */
function pathCrumbs(
  path: string,
  {
    home,
    linksLast = false,
    volumes,
  }: {
    home: string;
    /** Whether the last name is somewhere to go too, for a place inside it. */
    linksLast?: boolean;
    volumes: Volume[];
  },
): LocationCrumb[] {
  const hostPath = expandHomePath(path, home);
  // A place kept inside the home folder, iCloud Drive or a cloud service's
  // folder, is named for itself rather than walked to from home.
  const named = volumeOf(hostPath, volumes);
  const fromHome =
    named && named.path !== home && isInside(named.path, home)
      ? undefined
      : namesFromHome(path, home);
  const volume = fromHome ? undefined : named;
  const separator = separatorOf(hostPath);
  // The names below a disk are read off the whole path, which is what says
  // whether a backslash separates them; the part past `C:\` alone starts with
  // no drive, so it would read as one name.
  const names =
    fromHome ??
    (volume
      ? [
          volume.name,
          ...segmentsOf(hostPath).slice(segmentsOf(volume.path).length),
        ]
      : segmentsOf(hostPath));
  const first = names[0] ?? "";
  const rooted =
    fromHome !== undefined ||
    volume !== undefined ||
    hostPath.startsWith("/") ||
    isDrive(first);
  let at = "";
  return names.map((name, index) => {
    at =
      index === 0
        ? fromHome
          ? home
          : (volume?.path ?? startOf(name, separator))
        : join(at, name, separator);
    if (!rooted) {
      return { label: name };
    }
    return index === names.length - 1 && !linksLast
      ? { label: name, path: at }
      : { label: name, path: at, to: { href: folderHref(at), kind: "screen" } };
  });
}

/** Where a walk down a path on no known disk starts: a drive, or the root. */
function startOf(name: string, separator: string) {
  return isDrive(name) ? `${name}${separator}` : `${separator}${name}`;
}

/** The disk a path is on: the innermost one mounted at or above it. */
function volumeOf(hostPath: string, volumes: Volume[]) {
  return volumes
    .filter((volume) => isInside(hostPath, volume.path))
    .toSorted((a, b) => b.path.length - a.path.length)[0];
}
