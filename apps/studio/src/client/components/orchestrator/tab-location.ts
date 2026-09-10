import { type OpenTarget } from "@/client/lib/open-target";

import { folderHref } from "./file-tabs";
import { homeRelative, segmentsOf, separatorOf } from "./host-path";

/** What the tab on screen is showing, in the terms that page has for itself. */
export type TabLocation =
  | { kind: "app"; name: string; site?: string }
  | { kind: "apps" }
  | {
      /**
       * Where the file sits on the computer, when anything knows: what makes
       * the folders above it places the tab can go. Absent for a file the
       * window reaches only through a mount.
       */
      hostPath?: string;
      kind: "file";
      name: string;
      path: string;
    }
  | { kind: "folder"; path: string }
  | { kind: "newTab" }
  | { kind: "page"; url: string }
  | { kind: "task"; title: string }
  | { kind: "tasks" };

/** One part of the place the field shows. */
export interface LocationCrumb {
  /** What it says: a name along a path, or the screen the place sits under. */
  label: string;
  /** Where a press on it goes; absent on the last, which is where the tab is. */
  to?: OpenTarget;
}

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
    case "file": {
      return pathCrumbs(homeRelative(location.path, home), {
        home,
        reachable: location.hostPath !== undefined,
      });
    }
    case "folder": {
      return pathCrumbs(homeRelative(location.path, home), {
        home,
        reachable: true,
      });
    }
    case "newTab":
    case "page": {
      return [];
    }
    case "task": {
      return [
        { label: "Tasks", to: { href: "/orchestrator/tasks", kind: "screen" } },
        { label: location.title },
      ];
    }
    case "tasks": {
      return [{ label: "Tasks" }];
    }
  }
}

/** A name that is a whole volume on Windows, which is where a path there starts. */
function isDrive(name: string) {
  return /^[a-z]:$/i.test(name);
}

/**
 * A path as its names, each above the last a way to that folder.
 *
 * The names read as the field writes them, `~` and all, while where one goes is
 * the path the computer knows, so the home folder is written back out there. A
 * path that names no place on the computer -- a file under a mount the window
 * cannot resolve, a prefix under a root -- is names alone with nowhere to go.
 */
function pathCrumbs(
  shown: string,
  { home, reachable }: { home: string | undefined; reachable: boolean },
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
    return !rooted || !reachable || index === names.length - 1
      ? { label: name }
      : { label: name, to: { href: folderHref(at), kind: "screen" } };
  });
}

/** The path a name goes on the end of, however the one it goes on ends. */
function join(base: string, name: string, separator: string) {
  return base.endsWith(separator)
    ? `${base}${name}`
    : `${base}${separator}${name}`;
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
