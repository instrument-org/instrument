import { type OpenTarget } from "@/client/lib/open-target";
import { folderHref } from "@/shared/computer-href";
import { expandHomePath, namesFromHome } from "@instrument-org/shared";
import {
  type ChatId,
  ChatIdSchema,
  StoreId,
} from "@instrument-org/workspace/client";

import { isInside, segmentsOf, separatorOf } from "./host-path";

/** One part of the place the field shows. */
export interface LocationCrumb {
  /** What it says: a name along a path, or the screen the place sits under. */
  label: string;
  /** Where a press on it goes; absent on the last, which is where the tab is. */
  to?: OpenTarget;
}

/** A disk or a cloud service's folder, by the name the sidebar lists it under. */
export interface Volume {
  name: string;
  path: string;
}

/** The route a chat's tasks are at: the list, and each task's page under it. */
const TASKS_HREF = "/tasks";

/**
 * The address of one task's page: its session, and the chat whose store
 * holds it and whose list it was opened from.
 */
export function taskHref(id: StoreId.Session, chat: ChatId): string {
  return `${TASKS_HREF}/${id}?chat=${chat}`;
}

/** The address of a chat's task list; there is no list of every chat's tasks. */
export function tasksHref(chat: ChatId): string {
  return `${TASKS_HREF}?chat=${chat}`;
}

/**
 * The chat a task list's address names, which every list is for; none for
 * no chat or one that is not a chat's id, an address with no list at it.
 */
export function chatOfTasksList(chat: unknown): ChatId | undefined {
  const parsed = ChatIdSchema.safeParse(chat);
  return parsed.success ? parsed.data : undefined;
}

/** The address of the skills, which the window shows in Settings rather than as a screen. */
const SKILLS_HREF = "/skills";

/** The address of one skill, by the name a task loads it by. */
export function skillHref(name: string): string {
  return `${SKILLS_HREF}/${name}`;
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
      /** The chat whose list the task was opened from, which is where its crumb goes back to. */
      chat?: ChatId;
      kind: "task";
      title: string;
    }
  | { icon?: string; kind: "app"; name: string; site?: string }
  | { kind: "apps" }
  | { kind: "chat"; title: string }
  | {
      /** Where the folder really is, when that is not where it was walked to: an iCloud Drive app folder. */
      hostPath?: string;
      kind: "folder";
      path: string;
    }
  | { kind: "newTab" }
  | { kind: "page"; url: string }
  | {
      /** The chat whose tasks these are; none only on the way to the inbox. */
      chat?: ChatId;
      kind: "tasks";
    };

/**
 * The place the field shows, as the parts a person reads it in.
 *
 * One rule everywhere: the last part is what you are looking at, and everything
 * the place sits under is somewhere you can go. A file is under its folders, a
 * task under the work, an app page under Apps. An address is not one of these:
 * a site is one thing you type rather than a trail you walk, so a page has no
 * parts and the field says it whole.
 */
export function locationCrumbs(
  location: TabLocation,
  { home, volumes = [] }: { home: string; volumes?: Volume[] },
): LocationCrumb[] {
  switch (location.kind) {
    case "app": {
      return [
        { label: "Apps", to: { href: "/apps", kind: "screen" } },
        { label: location.name },
      ];
    }
    case "apps": {
      return [{ label: "Apps" }];
    }
    // A chat hangs from the chat beside the tabs rather than from a screen
    // under one, so there is nothing above it the field could go to.
    case "chat": {
      return [{ label: location.title }];
    }
    // A path reads the same whichever screen said it: the folder browser
    // hands over a path with the home folder as `~`, and a file arrives as it
    // sits on the disk.
    case "file":
    case "folder": {
      return pathCrumbs(location.path, { home, volumes });
    }
    case "newTab":
    case "page": {
      return [];
    }
    // A task opened from no chat's list has no list to go back to.
    case "task": {
      return [
        location.chat === undefined
          ? { label: "Tasks" }
          : {
              label: "Tasks",
              to: { href: tasksHref(location.chat), kind: "screen" },
            },
        { label: location.title },
      ];
    }
    case "tasks": {
      return [{ label: "Tasks" }];
    }
  }
}

/**
 * What an address under the tasks names: the list or one task by its
 * session, and the chat it is for when the address carries one. Nothing for
 * any other address, and nothing for an id that is not one.
 */
export function tasksOfHref(
  href: string,
): undefined | { chat?: ChatId; task?: StoreId.Session } {
  const url = new URL(href, "http://tabs");
  const { pathname } = url;
  const chat = ChatIdSchema.safeParse(url.searchParams.get("chat"));
  const forChat = chat.success ? { chat: chat.data } : {};
  if (pathname === TASKS_HREF || pathname === `${TASKS_HREF}/`) {
    return forChat;
  }
  if (!pathname.startsWith(`${TASKS_HREF}/`)) {
    return undefined;
  }
  const parsed = StoreId.SessionSchema.safeParse(
    pathname.slice(TASKS_HREF.length + 1),
  );
  return parsed.success ? { task: parsed.data, ...forChat } : undefined;
}

/** The address of the memories, which the window shows in Settings rather than as a screen. */
const MEMORY_HREF = "/memory";

/**
 * The memory an address names, by its name. Nothing for any other address,
 * and nothing for the memories as a whole, which have no address: the
 * Settings tab is where they are, and a tab is not a place a link goes.
 */
export function memoryOfHref(href: string): string | undefined {
  const pathname = new URL(href, "http://tabs").pathname;
  if (!pathname.startsWith(`${MEMORY_HREF}/`)) {
    return undefined;
  }
  const name = pathname.slice(MEMORY_HREF.length + 1);
  return name && !name.includes("/") ? name : undefined;
}

/**
 * The skill an address names, by the name a task loads it by. Nothing for
 * any other address, and nothing for the skills as a whole: the Settings tab
 * is where they are, the way it is for the memories.
 */
export function skillOfHref(href: string): string | undefined {
  const pathname = new URL(href, "http://tabs").pathname;
  if (!pathname.startsWith(`${SKILLS_HREF}/`)) {
    return undefined;
  }
  const segment = pathname.slice(SKILLS_HREF.length + 1);
  if (!segment || segment.includes("/")) {
    return undefined;
  }
  // The router writes a qualified name's colon as `%3A`.
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
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
  { home, volumes }: { home: string; volumes: Volume[] },
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
  const names =
    fromHome ??
    (volume
      ? [volume.name, ...segmentsOf(hostPath.slice(volume.path.length))]
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
    return !rooted || index === names.length - 1
      ? { label: name }
      : { label: name, to: { href: folderHref(at), kind: "screen" } };
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
