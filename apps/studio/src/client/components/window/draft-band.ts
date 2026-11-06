import { type ChosenItem, type Draft } from "@/shared/drafts";
import { fileHref, folderHref } from "@/shared/computer-href";
import { instrumentLinkOf } from "@instrument-org/shared";
import { useEffect } from "react";

import { type BrowserTabsHandle } from "./browser-tabs";
import { type ContextItem } from "./context-items";
import { type useWindowTabs } from "./window-tabs";

/** Something a draft can have open in its band: a file or folder, a page, or a screen such as an app's front. */
export type BandTarget =
  | ChosenItem
  | { kind: "page"; url: string }
  | { href: string; kind: "screen" };

/**
 * Opens a target as a tab of a draft's band without putting it up: it joins
 * the draft's chips, and the well or the side panel shows it only once its
 * chip is pressed. A target the band already has open is left as it is.
 */
export function openInBand({
  browser,
  group,
  target,
  windowTabs,
}: {
  browser: BrowserTabsHandle | null;
  group: string;
  target: BandTarget;
  windowTabs: Pick<
    ReturnType<typeof useWindowTabs>,
    "allTabs" | "openOrFocusScreen"
  >;
}): void {
  if (target.kind === "page") {
    const isOpen = windowTabs.allTabs.some(
      (tab) =>
        tab.group === group && tab.kind === "page" && tab.url === target.url,
    );
    if (!isOpen) {
      browser?.openBehind(target.url, group);
    }
    return;
  }
  windowTabs.openOrFocusScreen(
    target.kind === "screen"
      ? target.href
      : target.kind === "folder"
        ? folderHref(target.path)
        : fileHref(target.path),
    { group, isOpened: true },
  );
}

/** What taking an offered chip opens in the band: the files or folders it points at, or the page or screen itself. */
export function targetsOf(item: ContextItem): BandTarget[] {
  if (item.kind === "chosen") {
    return [item.item];
  }
  if (item.kind === "chat") {
    return [];
  }
  if (item.items !== undefined && item.items.length > 0) {
    return item.items;
  }
  return item.tab.kind === "page"
    ? item.tab.url === undefined
      ? []
      : [{ kind: "page", url: item.tab.url }]
    : [{ href: item.tab.href, kind: "screen" }];
}

/**
 * Turns the files, folders, pages and apps a draft's `context` names into
 * tabs of its band as the draft is shown, and takes them out of `context`,
 * so everything a draft shows is one of its tabs. What a draft is made with
 * (asked about from a selection, written into its file by hand) arrives that
 * way. Another chat stays in `context`: it has no place in a band.
 */
export function useContextIntoBand({
  draft,
  onChange,
  open,
}: {
  draft: Draft | undefined;
  onChange: (update: (draft: Draft) => Draft) => void;
  open: (target: BandTarget) => void;
}) {
  const entries = draft?.context ?? [];
  const movable = entries.filter((entry) => entry.kind !== "chat");
  const signature = movable
    .map((entry) => (entry.kind === "link" ? entry.url : entry.path))
    .join("\n");
  useEffect(() => {
    if (movable.length === 0) {
      return;
    }
    for (const entry of movable) {
      if (entry.kind === "link") {
        const href = instrumentLinkOf(entry.url)?.href;
        open(
          href === undefined
            ? { kind: "page", url: entry.url }
            : { href, kind: "screen" },
        );
      } else {
        open(entry);
      }
    }
    onChange((current) => {
      const left = (current.context ?? []).filter(
        (entry) => entry.kind === "chat",
      );
      const { context: _was, ...rest } = current;
      return left.length > 0 ? { ...rest, context: left } : rest;
    });
    // Only as what it names changes; the openers are made afresh each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, signature]);
}
