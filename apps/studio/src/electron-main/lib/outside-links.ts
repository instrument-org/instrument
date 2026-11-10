import { outsideLinkOf, PAGES_DOMAIN } from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";

import { folderHref } from "@/shared/computer-href";

import { type AppWindowAsk } from "../windows/app-window-asks";
import { hostPathOfUrlPath } from "./computer-files";
import { isFromInternet } from "./download-mark";
import { logger } from "./electron-logger";
import { fetchHostedPage, keepHostedPage } from "./hosted-page";
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
 * A page runs, and one opened in the app's browser reads its folder and
 * below, so a page a site just saved into Downloads could read the rest. A
 * link to a page the system marks as downloaded opens its folder with it
 * selected, for the person to open themselves; any other page opens.
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
 * How a path from a link is judged, and how a hosted page is fetched and
 * kept; each is the real one outside a test.
 */
type PathChecks = {
  fetchPage?: typeof fetchHostedPage;
  hostPaths?: path.PlatformPath;
  isDownloaded?: (hostPath: string) => Promise<boolean>;
  isRefused?: (hostPath: string) => Promise<boolean>;
  keepPage?: (id: string, body: Uint8Array) => Promise<string>;
  placeOf?: (hostPath: string) => Promise<Place>;
};

/**
 * What a link asks of the window, in order: nothing for a link that names
 * nothing. A link to several files asks for each just as a link to one does,
 * once each however many ways it is written, and then says how many it left
 * past the cap.
 */
export async function asksOfOutsideLink(
  url: string,
  checks: PathChecks = {},
): Promise<AppWindowAsk[]> {
  const link = outsideLinkOf(url);
  switch (link?.kind) {
    case undefined: {
      return [];
    }
    case "screen": {
      return [{ href: link.href, type: "openScreen" }];
    }
    case "new": {
      return [
        {
          ...(link.project === undefined ? {} : { project: link.project }),
          type: "newChat",
          words: link.words,
        },
      ];
    }
    case "file": {
      const ask = await askOfPath(link.path, checks);
      return ask ? [ask] : [];
    }
    case "files": {
      const asks = new Map<string, AppWindowAsk>();
      for (const ask of await Promise.all(
        link.paths.map((each) => askOfPath(each, checks)),
      )) {
        // Two spellings of one path ask for the same thing.
        if (ask) {
          asks.set(JSON.stringify(ask), ask);
        }
      }
      const all = [...asks.values()];
      if (link.notOpened > 0) {
        all.push({ count: link.notOpened, type: "notOpened" });
      }
      return all;
    }
    case "page": {
      return [await askOfPage(link.id, checks)];
    }
  }
}

/**
 * What a hosted page asks of the window: the copy kept of it in Downloads,
 * opened as a page, which is safe because a page there reaches only itself
 * (`local-file-policy.ts`); or, when its host does not hand it over or the
 * folder takes no file, the window saying so and opening nothing.
 */
async function askOfPage(
  id: string,
  { fetchPage = fetchHostedPage, keepPage = keepHostedPage }: PathChecks,
): Promise<AppWindowAsk> {
  const host = `${id}.${PAGES_DOMAIN}`;
  const fetched = await fetchPage(id);
  if ("failed" in fetched) {
    logger.scope("outside-link").info(`${host} ${fetched.failed}`);
    return { host, type: "pageNotOpened", why: "noAnswer" };
  }
  try {
    return { hostPath: await keepPage(id, fetched.body), type: "openFile" };
  } catch (error) {
    logger
      .scope("outside-link")
      .warn(`A copy of ${host} could not be kept in Downloads`, error);
    return { host, type: "pageNotOpened", why: "notKept" };
  }
}

/**
 * What a path from a link asks of the window, or nothing for a path that is
 * not plainly one on this computer (a step up, a network share, a relative
 * one) or a place the app refuses to show.
 */
async function askOfPath(
  linkPath: string,
  {
    hostPaths = path,
    isDownloaded = isFromInternet,
    isRefused = isRefusedFile,
    placeOf = placeOnDisk,
  }: PathChecks,
): Promise<AppWindowAsk | undefined> {
  const hostPath = hostPathOfUrlPath(linkPath, hostPaths);
  if (
    hostPath === undefined ||
    // On Windows a path from a link names its drive: one starting at a
    // slash is on whichever drive is current.
    (hostPaths.sep === "\\" && !/^[A-Z]:\\/i.test(hostPath)) ||
    (await isRefused(hostPath))
  ) {
    return undefined;
  }
  const place = await placeOf(hostPath);
  if (place === "folder") {
    return { href: folderHref(hostPath), type: "openScreen" };
  }
  // Never a file to open: the window says it is not there, over the folder
  // it was in when that is there.
  if (place === "missing") {
    const folder = hostPaths.dirname(hostPath);
    return {
      ...((await placeOf(folder)) === "folder" ? { folder } : {}),
      name: hostPaths.basename(hostPath),
      type: "missingFile",
    };
  }
  if (PAGE.test(hostPath) && (await isDownloaded(hostPath))) {
    return {
      href: folderHref(hostPaths.dirname(hostPath), {
        select: hostPaths.basename(hostPath),
      }),
      type: "openScreen",
    };
  }
  return { hostPath, type: "openFile" };
}

/**
 * What is at a path: a folder, nothing, or something else, which is also
 * what a path the system will not say anything about counts as, so a file in
 * a folder the app may not read is shown saying so rather than as missing.
 */
type Place = "folder" | "missing" | "other";

async function placeOnDisk(hostPath: string): Promise<Place> {
  try {
    return (await fs.stat(hostPath)).isDirectory() ? "folder" : "other";
  } catch (error) {
    return error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
      ? "missing"
      : "other";
  }
}

/** The ones a link is let through by, for this process. */
const processGate = createLinkGate();

/**
 * Opens what a link from outside names, through `ask`, which puts it in
 * front of the person once the window can show it: everything one link asks
 * for in one call, so the window comes forward once. A link counts once
 * against the gate, however many paths it carries. Every link says in the
 * log what came of it, by its noun alone, since a `new` link's words and a
 * file's path are the person's.
 */
export async function openOutsideLink(
  url: string,
  {
    ask,
    checks,
    gate = processGate,
    log,
    waiting,
  }: {
    ask: (asks: readonly AppWindowAsk[]) => void;
    checks?: PathChecks;
    gate?: (url: string) => boolean;
    log: (line: string) => void;
    /** How many asks wait for the window now. */
    waiting: () => number;
  },
) {
  const noun = nounOf(url);
  if (waiting() >= WAITING_MAX) {
    log(
      `Let a ${noun} link go: ${WAITING_MAX} asks already wait for the window`,
    );
    return;
  }
  if (!gate(url)) {
    log(`Let a ${noun} link go: the same link again, or too many this minute`);
    return;
  }
  const asked = await asksOfOutsideLink(url, checks);
  if (asked.length === 0) {
    log(
      `A ${noun} link opens nothing: it names nothing here, or a path that is not plainly this computer's or that the app refuses`,
    );
    return;
  }
  log(
    `A ${noun} link asks the window to ${asked.map((each) => each.type).join(", ")}`,
  );
  ask(asked);
}

/** The noun a link leads with, which is all of it the log keeps. */
function nounOf(url: string) {
  return URL.canParse(url)
    ? new URL(url).host.toLowerCase() || "bare"
    : "malformed";
}
