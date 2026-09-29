import {
  CHATS_HREF,
  NEW_TAB_HREF,
  WEB_HREF,
} from "@/client/atoms/orchestrator";
import {
  FileSystemFolderGlyph,
  FileTypeIcon,
} from "@/client/components/extend/file-system";
import { StoreId, type TaskId } from "@instrument-org/workspace/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ChatTeardropTextIcon } from "@phosphor-icons/react/ChatTeardropText";
import { CheckSquareIcon } from "@phosphor-icons/react/CheckSquare";
import { CompassIcon } from "@phosphor-icons/react/Compass";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { GraduationCapIcon } from "@phosphor-icons/react/GraduationCap";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { type ReactNode } from "react";

import { AppIcon } from "./app-icon";
import { computerName } from "./computer-name";
import { RECENTS_ROOT } from "./computer-page";
import { joinHostPath, segmentsOf } from "./host-path";
import { IDEAS_HREF, ideaTitleOf } from "./ideas";
import { SKILLS_HREF, type TabLocation, tasksOfHref } from "./tab-location";
import { parseHref } from "./window-tabs";

/**
 * What an address alone cannot say about a screen: the names of the things
 * it stands for, kept by the window and read off the address's id.
 */
interface ScreenNames {
  appsBySlug: Map<string, { name: string; site: string | undefined }>;
  /** Each chat's title by its session, for a tab standing on one; a chat not in it is a "Chat". */
  chatTitles?: Map<StoreId.Session, string>;
  /** Each task's title by its id, for a tab standing on one; a task not in it is a "Task". */
  taskTitles?: Map<TaskId, string>;
}

/** Where a screen tab is, in the terms the row above it says a place in. */
export function screenLocation(
  href: string,
  { appsBySlug, chatTitles, taskTitles }: ScreenNames,
): TabLocation {
  const { pathname, search } = parseHref(href);
  if (pathname === NEW_TAB_HREF) {
    return { kind: "newTab" };
  }
  if (pathname === "/orchestrator/computer") {
    const file = search.get("file");
    if (file) {
      return {
        kind: "file",
        name: segmentsOf(file).at(-1) ?? file,
        path: file,
      };
    }
    return { kind: "folder", path: folderPathOf(search) };
  }
  if (pathname.startsWith("/orchestrator/apps/")) {
    const slug = pathname.slice("/orchestrator/apps/".length);
    const app = appsBySlug.get(slug);
    return {
      kind: "app",
      name: app?.name ?? slug,
      ...(app?.site ? { site: app.site } : {}),
    };
  }
  if (pathname === "/orchestrator/apps") {
    return { kind: "apps" };
  }
  if (pathname.startsWith(`${IDEAS_HREF}/`)) {
    return {
      kind: "idea",
      title: ideaTitleOf(pathname.slice(IDEAS_HREF.length + 1)),
    };
  }
  if (pathname === IDEAS_HREF) {
    return { kind: "ideas" };
  }
  // A skill is addressed by its name, which is also what it is called: the
  // exact name a task loads it by is the one the reader has for it too.
  if (pathname.startsWith(`${SKILLS_HREF}/`)) {
    return { kind: "skill", name: skillNameOf(pathname) };
  }
  if (pathname === SKILLS_HREF) {
    return { kind: "skills" };
  }
  if (pathname.startsWith(`${CHATS_HREF}/`)) {
    return { kind: "chat", title: chatTitleOf(pathname, chatTitles) };
  }
  const tasks = tasksOfHref(href);
  if (tasks?.task !== undefined) {
    return {
      kind: "task",
      ...(tasks.chat === undefined ? {} : { chat: tasks.chat }),
      title: taskTitles?.get(tasks.task) ?? "Task",
    };
  }
  if (tasks) {
    return { kind: "tasks" };
  }
  // A screen the window has no words for reads as the new tab: the place
  // with nothing in particular in it.
  return { kind: "newTab" };
}

/** What a screen tab is called and drawn with, read off its address. */
export function screenPresentation(
  href: string,
  { appsBySlug, chatTitles, taskTitles }: ScreenNames,
): { icon: ReactNode; title: string } {
  const { pathname, search } = parseHref(href);
  if (pathname === NEW_TAB_HREF) {
    return {
      icon: <MagnifyingGlassIcon className="size-3.5" />,
      title: "New tab",
    };
  }
  if (pathname === WEB_HREF) {
    return { icon: <GlobeIcon className="size-3.5" />, title: "Browser" };
  }
  if (pathname === "/orchestrator/computer") {
    const file = search.get("file");
    if (file) {
      const name = segmentsOf(file).at(-1) ?? file;
      return {
        icon: <FileTypeIcon className="size-4" fileName={name} />,
        title: name,
      };
    }
    return {
      icon: <FileSystemFolderGlyph className="h-3 w-auto" />,
      title: folderTitle(search),
    };
  }
  if (pathname.startsWith(`${CHATS_HREF}/`)) {
    return {
      icon: <ChatTeardropTextIcon className="size-3.5" />,
      title: chatTitleOf(pathname, chatTitles),
    };
  }
  if (pathname.startsWith("/orchestrator/apps/")) {
    const slug = pathname.slice("/orchestrator/apps/".length);
    const app = appsBySlug.get(slug);
    return {
      icon: app ? (
        <AppIcon name={app.name} site={app.site} size="sm" />
      ) : (
        <AppWindowIcon className="size-3.5" />
      ),
      title: app?.name ?? slug,
    };
  }
  if (pathname === "/orchestrator/apps") {
    return { icon: <AppWindowIcon className="size-3.5" />, title: "Apps" };
  }
  if (pathname.startsWith(`${IDEAS_HREF}/`)) {
    return {
      icon: <CompassIcon className="size-3.5" />,
      title: ideaTitleOf(pathname.slice(IDEAS_HREF.length + 1)),
    };
  }
  if (pathname === IDEAS_HREF) {
    return { icon: <CompassIcon className="size-3.5" />, title: "Ideas" };
  }
  if (pathname.startsWith(`${SKILLS_HREF}/`)) {
    return {
      icon: <GraduationCapIcon className="size-3.5" />,
      title: skillNameOf(pathname),
    };
  }
  if (pathname === SKILLS_HREF) {
    return {
      icon: <GraduationCapIcon className="size-3.5" />,
      title: "Skills",
    };
  }
  const tasks = tasksOfHref(href);
  // The list wears the mark the chat's menu opens it with; one task, a single box of it.
  if (tasks?.task !== undefined) {
    return {
      icon: <CheckSquareIcon className="size-3.5" />,
      title: taskTitles?.get(tasks.task) ?? "Task",
    };
  }
  if (tasks) {
    return { icon: <ListChecksIcon className="size-3.5" />, title: "Tasks" };
  }
  return { icon: <MagnifyingGlassIcon className="size-3.5" />, title: "Tab" };
}

/** The chat a screen address stands on, by the title the window has for it. */
function chatTitleOf(pathname: string, chatTitles: ScreenNames["chatTitles"]) {
  const id = StoreId.SessionSchema.safeParse(
    pathname.slice(`${CHATS_HREF}/`.length),
  );
  return (id.success ? chatTitles?.get(id.data) : undefined) ?? "Chat";
}

/**
 * The folder a folder tab's address stands in: the root the browser is rooted
 * at, and the walk below it, as one path. The home folder stays `~`, which is
 * how the row writes it; the recents are no folder at all.
 */
function folderPathOf(search: URLSearchParams) {
  const root = search.get("root") ?? "~";
  return root === RECENTS_ROOT
    ? ""
    : joinHostPath(root, search.get("path") ?? "");
}

/**
 * What a folder tab is called: the last name along the walk below the root,
 * and with no walk, the root itself, named the way the place that opened it
 * is. The top of the disk has no name along its path, so it is the computer.
 */
function folderTitle(search: URLSearchParams) {
  const below = segmentsOf(search.get("path") ?? "").at(-1);
  if (below) {
    return below;
  }
  const root = search.get("root") ?? "~";
  if (root === "~") {
    return "Home";
  }
  if (root === RECENTS_ROOT) {
    return "Recents";
  }
  return segmentsOf(root).at(-1) ?? computerName();
}

/**
 * The skill a screen address stands on, by the name the reader has for it:
 * the part after the source's prefix, since `workspace:tdd` is an address
 * for a task to load and `tdd` is what the tab is called. The router writes
 * that colon into the address as `%3A`, so the segment is decoded first.
 */
function skillNameOf(pathname: string) {
  const segment = pathname.slice(`${SKILLS_HREF}/`.length);
  let name = segment;
  try {
    name = decodeURIComponent(segment);
  } catch {
    // Not valid encoding, so the segment is the name as written.
  }
  return name.slice(name.lastIndexOf(":") + 1);
}
