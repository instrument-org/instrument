import { NEW_TAB_HREF } from "@/client/atoms/orchestrator";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { FileIcon } from "@/client/components/file-icon";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { type TaskId } from "@instrument-org/workspace/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { type ReactNode } from "react";

import { AppIcon } from "./app-icon";
import { computerName } from "./computer-name";
import { parseHref } from "./window-tabs";

/** What a screen tab is called and drawn with, read off its address. */
export function screenPresentation(
  href: string,
  {
    appsBySlug,
    childTitles,
  }: {
    appsBySlug: Map<string, { name: string; site: string | undefined }>;
    childTitles: Map<TaskId, string>;
  },
): { icon: ReactNode; title: string } {
  const { pathname, search } = parseHref(href);
  if (pathname === NEW_TAB_HREF) {
    return {
      icon: <MagnifyingGlassIcon className="size-3.5" />,
      title: "New tab",
    };
  }
  if (pathname === "/orchestrator/computer") {
    const file = search.get("file");
    if (file) {
      const name = file.split("/").at(-1) ?? file;
      return {
        icon: <FileIcon className="size-4" filename={name} />,
        title: name,
      };
    }
    const folder = (search.get("path") ?? "")
      .replace(/\/$/, "")
      .split("/")
      .at(-1);
    return {
      icon: <FileSystemFolderGlyph className="h-3 w-auto" />,
      title: folder || computerName(),
    };
  }
  if (pathname.startsWith("/orchestrator/tasks/")) {
    const id = pathname.slice("/orchestrator/tasks/".length) as TaskId;
    return {
      icon: <InstrumentGlyph className="size-3.5" />,
      title: childTitles.get(id) ?? "Task",
    };
  }
  if (pathname === "/orchestrator/tasks") {
    return { icon: <InstrumentGlyph className="size-3.5" />, title: "Tasks" };
  }
  if (pathname.startsWith("/orchestrator/apps/")) {
    const slug = pathname.slice("/orchestrator/apps/".length);
    const app = appsBySlug.get(slug);
    return {
      icon: app ? (
        <AppIcon site={app.site} size="sm" />
      ) : (
        <AppWindowIcon className="size-3.5" />
      ),
      title: app?.name ?? slug,
    };
  }
  if (pathname === "/orchestrator/apps") {
    return { icon: <AppWindowIcon className="size-3.5" />, title: "Apps" };
  }
  return { icon: <MagnifyingGlassIcon className="size-3.5" />, title: "Tab" };
}
