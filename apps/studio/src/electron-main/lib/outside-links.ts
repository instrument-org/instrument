import { outsideLinkOf } from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";

import { folderHref } from "@/shared/computer-href";

import { type AppWindowAsk } from "../windows/app-window-asks";
import { hostPathOfUrlPath } from "./computer-files";
import { isRefusedFile } from "./refused-files";

/**
 * Links from outside the app: a browser, another app, a note. The OS hands
 * them over with nothing to say who wrote them, and a site the person has
 * told their browser to let open Instrument can send one with no click at
 * all. So a link only ever puts something in front of the person: a screen,
 * a file or folder, or a new chat's words, never sent. See
 * `docs/architecture/deep-links.md`.
 */

/** How long the same link again is the same click, not a new one. */
const REPEAT_MS = 3000;

/** How many links a minute open; a site looping on one gets no further. */
const PER_MINUTE = 10;

/** How many asks may wait for the window before another link is let go. */
const WAITING_MAX = 10;

/**
 * A page runs, and one opened in the app's browser reads the files beside it,
 * so a page a site just saved into Downloads could read the rest. A link to
 * one opens its folder with it selected, for the person to open themselves.
 */
const PAGE = /\.(?:x?html?|shtml)$/i;

/**
 * Lets a link through, or not: the same link again within a moment, or more
 * than a few a minute, is let go.
 */
export function createLinkGate({
  now = Date.now,
}: { now?: () => number } = {}) {
  let recent: { at: number; url: string }[] = [];
  return (url: string): boolean => {
    const at = now();
    recent = recent.filter((link) => at - link.at < 60_000);
    if (
      recent.length >= PER_MINUTE ||
      recent.some((link) => link.url === url && at - link.at < REPEAT_MS)
    ) {
      return false;
    }
    recent.push({ at, url });
    return true;
  };
}

/**
 * What a link asks of the window, or nothing for a link that names nothing,
 * a path that is not plainly one on this computer (a step up, a network
 * share, a relative one), or a place the app refuses to show.
 */
export async function askOfOutsideLink(
  url: string,
  {
    hostPaths = path,
    isRefused = isRefusedFile,
  }: {
    hostPaths?: path.PlatformPath;
    isRefused?: (hostPath: string) => Promise<boolean>;
  } = {},
): Promise<AppWindowAsk | undefined> {
  const link = outsideLinkOf(url);
  switch (link?.kind) {
    case undefined: {
      return undefined;
    }
    case "screen": {
      return { href: link.href, type: "openScreen" };
    }
    case "new": {
      return {
        ...(link.topic === undefined ? {} : { topic: link.topic }),
        type: "newChat",
        words: link.words,
      };
    }
    case "file": {
      const hostPath = hostPathOfUrlPath(link.path, hostPaths);
      if (
        hostPath === undefined ||
        // On Windows a path from a link names its drive: one starting at a
        // slash is on whichever drive is current.
        (hostPaths.sep === "\\" && !/^[A-Z]:\\/i.test(hostPath)) ||
        (await isRefused(hostPath))
      ) {
        return undefined;
      }
      if (await isFolder(hostPath)) {
        return { href: folderHref(hostPath), type: "openScreen" };
      }
      if (PAGE.test(hostPath)) {
        return {
          href: folderHref(hostPaths.dirname(hostPath), {
            select: hostPaths.basename(hostPath),
          }),
          type: "openScreen",
        };
      }
      return { hostPath, type: "openFile" };
    }
  }
}

async function isFolder(hostPath: string) {
  try {
    return (await fs.stat(hostPath)).isDirectory();
  } catch {
    return false;
  }
}

/** The ones a link is let through by, for this process. */
const gate = createLinkGate();

/**
 * Opens what a link from outside names, through `ask`, which puts it in
 * front of the person once the window can show it.
 */
export async function openOutsideLink(
  url: string,
  {
    ask,
    waiting,
  }: {
    ask: (ask: AppWindowAsk) => void;
    /** How many asks wait for the window now. */
    waiting: () => number;
  },
) {
  if (waiting() >= WAITING_MAX || !gate(url)) {
    return;
  }
  const asked = await askOfOutsideLink(url);
  if (asked) {
    ask(asked);
  }
}
