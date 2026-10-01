import { type OpenTarget } from "@/client/lib/open-target";
import { folderHref } from "@/shared/computer-href";
import { expandHomePath, namesFromHome } from "@instrument-org/shared";
import {
  StoreId,
  type TaskId,
  TaskIdSchema,
} from "@instrument-org/workspace/client";

import { isInside, segmentsOf, separatorOf } from "./host-path";
import { DISCOVER_HREF } from "./ideas";

/** One part of the place the field shows. */
export interface LocationCrumb {
  /** What it says: a name along a path, or the screen the place sits under. */
  label: string;
  /** Where a press on it goes; absent on the last, which is where the tab is. */
  to?: OpenTarget;
}

/** A disk the computer has mounted, by the name the sidebar lists it under. */
export interface Volume {
  name: string;
  path: string;
}

/** The route a chat's tasks are at: the list, and each task's page under it. */
const TASKS_HREF = "/tasks";

/** The address of one task's page, carrying the chat whose list it was opened from. */
export function taskHref(id: TaskId, chat?: StoreId.Session): string {
  return chat === undefined
    ? `${TASKS_HREF}/${id}`
    : `${TASKS_HREF}/${id}?chat=${chat}`;
}

/** The address of a chat's task list, or of every task with no chat named. */
export function tasksHref(chat?: StoreId.Session): string {
  return chat === undefined ? TASKS_HREF : `${TASKS_HREF}?chat=${chat}`;
}

/** The route the Skills screen is at: every skill a task can load, and each one's page under it. */
export const SKILLS_HREF = "/skills";

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
      chat?: StoreId.Session;
      kind: "task";
      title: string;
    }
  | { kind: "app"; name: string; site?: string }
  | { kind: "apps" }
  | { kind: "chat"; title: string }
  | { kind: "folder"; path: string }
  | { kind: "idea"; title: string }
  | { kind: "ideas" }
  | { kind: "newTab" }
  | { kind: "page"; url: string }
  | { kind: "skill"; name: string }
  | { kind: "skills" }
  | { kind: "tasks" };

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
    case "idea": {
      return [
        { label: "Ideas", to: { href: DISCOVER_HREF, kind: "screen" } },
        { label: location.title },
      ];
    }
    case "ideas": {
      return [{ label: "Ideas" }];
    }
    case "newTab":
    case "page": {
      return [];
    }
    case "skill": {
      return [
        { label: "Skills", to: { href: SKILLS_HREF, kind: "screen" } },
        { label: location.name },
      ];
    }
    case "skills": {
      return [{ label: "Skills" }];
    }
    case "task": {
      return [
        {
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
 * What an address under the tasks names: the list or one task by id, and
 * the chat it is for when the address carries one. Nothing for any other
 * address, and nothing for an id that is not one.
 */
export function tasksOfHref(
  href: string,
): undefined | { chat?: StoreId.Session; task?: TaskId } {
  const url = new URL(href, "http://tabs");
  const { pathname } = url;
  const chat = StoreId.SessionSchema.safeParse(url.searchParams.get("chat"));
  const forChat = chat.success ? { chat: chat.data } : {};
  if (pathname === TASKS_HREF || pathname === `${TASKS_HREF}/`) {
    return forChat;
  }
  if (!pathname.startsWith(`${TASKS_HREF}/`)) {
    return undefined;
  }
  const parsed = TaskIdSchema.safeParse(pathname.slice(TASKS_HREF.length + 1));
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
  const fromHome = namesFromHome(path, home);
  const hostPath = expandHomePath(path, home);
  const volume = fromHome ? undefined : volumeOf(hostPath, volumes);
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
