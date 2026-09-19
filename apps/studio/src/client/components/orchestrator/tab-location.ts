import { type OpenTarget } from "@/client/lib/open-target";
import { type TaskId, TaskIdSchema } from "@instrument-org/workspace/client";

import { folderHref } from "./file-tabs";
import { homeRelative, segmentsOf, separatorOf } from "./host-path";
import { IDEAS_HREF } from "./ideas";

/** One part of the place the field shows. */
export interface LocationCrumb {
  /** What it says: a name along a path, or the screen the place sits under. */
  label: string;
  /** Where a press on it goes; absent on the last, which is where the tab is. */
  to?: OpenTarget;
}

/** The address of a thread's tasks, which the pane shows as its face rather than as a screen. */
const TASKS_HREF = "/orchestrator/tasks";

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
  | { kind: "activity" }
  | { kind: "app"; name: string; site?: string }
  | { kind: "apps" }
  | { kind: "folder"; path: string }
  | { kind: "idea"; title: string }
  | { kind: "ideas" }
  | { kind: "newTab" }
  | { kind: "page"; url: string }
  | { kind: "task"; title: string }
  | { kind: "tasks" }
  | { kind: "thread"; title: string };

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
  { home }: { home: string | undefined },
): LocationCrumb[] {
  switch (location.kind) {
    // Activity is the whole chat laid flat, so like a thread it hangs from
    // the chat and sits under no screen.
    case "activity": {
      return [{ label: "Activity" }];
    }
    case "app": {
      return [
        { label: "Apps", to: { href: "/orchestrator/apps", kind: "screen" } },
        { label: location.name },
      ];
    }
    case "apps": {
      return [{ label: "Apps" }];
    }
    // A path is read the way a person writes one, whichever screen said it:
    // the folder browser hands over a path with the home folder already as
    // `~`, and a file arrives as it sits on the disk.
    case "file":
    case "folder": {
      return pathCrumbs(homeRelative(location.path, home), { home });
    }
    case "idea": {
      return [
        { label: "Ideas", to: { href: IDEAS_HREF, kind: "screen" } },
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
    case "task": {
      return [
        { label: "Tasks", to: { href: TASKS_HREF, kind: "screen" } },
        { label: location.title },
      ];
    }
    case "tasks": {
      return [{ label: "Tasks" }];
    }
    // A thread hangs from the chat beside the tabs rather than from a screen
    // under one, so there is nothing above it the field could go to.
    case "thread": {
      return [{ label: location.title }];
    }
  }
}

/**
 * What an address under the tasks names: the list, or one task by id.
 * Nothing for any other address, and nothing for an id that is not one.
 */
export function tasksFaceOfHref(href: string): undefined | { task?: TaskId } {
  const pathname = new URL(href, "http://tabs").pathname;
  if (pathname === TASKS_HREF) {
    return {};
  }
  if (!pathname.startsWith(`${TASKS_HREF}/`)) {
    return undefined;
  }
  const parsed = TaskIdSchema.safeParse(pathname.slice(TASKS_HREF.length + 1));
  return parsed.success ? { task: parsed.data } : undefined;
}

/** The address of the memories, which the window shows in Settings rather than as a screen. */
const MEMORY_HREF = "/orchestrator/memory";

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
 * The names read as the field writes them, `~` and all, while where one goes is
 * the path the computer knows, so the home folder is written back out there. A
 * path that names no place on the computer -- a prefix under a root -- is
 * names alone with nowhere to go.
 */
function pathCrumbs(
  shown: string,
  { home }: { home: string | undefined },
): LocationCrumb[] {
  const separator = separatorOf(shown);
  const names = segmentsOf(shown);
  const first = names[0] ?? "";
  const rooted = first === "~" || shown.startsWith("/") || isDrive(first);
  let at = "";
  return names.map((name, index) => {
    at =
      index === 0
        ? startOf(name, { home, separator })
        : join(at, name, separator);
    return !rooted || index === names.length - 1
      ? { label: name }
      : { label: name, to: { href: folderHref(at), kind: "screen" } };
  });
}

/** Where a walk down a path starts: the home folder, a volume, or the disk. */
function startOf(
  name: string,
  { home, separator }: { home: string | undefined; separator: string },
) {
  if (name === "~") {
    // Written out where the window knows it, since a folder is opened by the
    // path the computer has for it; the workspace reads `~` either way.
    return home ?? "~";
  }
  return isDrive(name) ? `${name}${separator}` : `${separator}${name}`;
}
