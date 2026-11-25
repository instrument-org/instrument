import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { isEqual } from "radashi";

import { type ChatId } from "../schemas/chat-id";
import { type LayoutTab } from "../schemas/group-layout";
import {
  type WindowBox,
  type WindowLook,
  type WindowSide,
} from "../schemas/window-look";
import { type WindowCamera } from "../types";
import { askWindow } from "./chat/window-tab";
import { hostPathWithin } from "./host-path";
import { agentPathOfFileUrl, agentPathOfHostFile } from "./local-page-address";
import { reachOf } from "./permissions/rules";
import { getWorkspaceConfig } from "./workspace-config";
import { type WorkspaceFsLayout } from "./workspace-fs-layout";

/**
 * A picture of the person's window as they see it, with each part the chat
 * may not read blanked: a side's page in a file or frame the chat cannot
 * read, with a password field up, or a screen not listed here, and a picture
 * of a file out of the chat's reach. Everything else (the sidebar, the rows
 * of tabs, the gaps between sides, menus and dialogs) stays as drawn.
 */

/** Built-in pages with nothing on them an agent is kept from. Any other is blanked. */
const SHOWN_PAGES: ReadonlySet<string> = new Set([
  "instrument://screen/apps",
  "instrument://screen/bookmarks",
  "instrument://screen/browser",
  "instrument://screen/chats",
  "instrument://screen/release-notes",
  "instrument://screen/shortcuts",
  "instrument://settings/about",
  "instrument://settings/apps",
  "instrument://settings/dictation",
  "instrument://settings/general",
  "instrument://settings/memory",
  "instrument://settings/skills",
  "instrument://settings/support",
]);

const SHOWN_HOSTS = /^instrument:\/\/(?:memory|project|skill)\//;

/**
 * How long what is up has to have been up. A frame asked for can be one from
 * a moment before, showing what stood there then.
 */
const STILL_MS = 400;
/** How many times a window that keeps changing is tried. */
const TRIES = 3;
/** How long the window has to say what it draws: it draws two frames first. */
const LOOK_TIMEOUT_MS = 3000;

/** A part left out of the picture, and why, in the agent's terms. */
export interface HiddenPart {
  /** The side's or page's tab, for a tab. */
  tab?: string;
  why: string;
}

export interface WindowPicture {
  hidden: HiddenPart[];
  png: Buffer;
}

/** What the decisions read, beside the window's own account. */
interface Reading {
  camera: WindowCamera;
  chatId: ChatId;
  layout: WorkspaceFsLayout;
}

/**
 * Takes the picture, or says why there is none. The window is read before
 * and after the frame is taken, and one whose parts changed meanwhile is
 * taken again: nothing says which moment a frame is of.
 */
export async function takeWindowPicture({
  askedBy,
  layout,
  sleepFor = (ms) => sleep(ms),
  window,
}: {
  askedBy: ChatId;
  layout: WorkspaceFsLayout | undefined;
  sleepFor?: (ms: number) => Promise<unknown>;
  window: number;
}): Promise<WindowPicture | { error: string }> {
  const camera = getWorkspaceConfig().windowCamera;
  if (!camera || !layout) {
    return { error: "there is no window to look at." };
  }
  const reading: Reading = { camera, chatId: askedBy, layout };
  const look = async (): Promise<Looked | { error: string }> => {
    const answer = await askWindow({
      action: { kind: "look" },
      askedBy,
      group: askedBy,
      timeoutMs: LOOK_TIMEOUT_MS,
      window,
    });
    if (!answer?.look) {
      return { error: answer?.error ?? "the window did not answer." };
    }
    const shows = await decide(answer.look, reading);
    return {
      blanked: blankedBoxes(answer.look, shows, layout),
      look: answer.look,
      shows,
    };
  };
  for (let tried = 0; tried < TRIES; tried += 1) {
    const first = await look();
    if ("error" in first) {
      return first;
    }
    await sleepFor(STILL_MS);
    const before = await look();
    if ("error" in before) {
      return before;
    }
    if (!isSameWindow(first, before)) {
      continue;
    }
    const frame = await camera.capture(window);
    if (!frame) {
      return {
        error: "the window is not on screen, so there is nothing to see.",
      };
    }
    const after = await look();
    if ("error" in after || !isSameWindow(before, after)) {
      continue;
    }
    return {
      hidden: hiddenParts(after),
      png: frame.masked({ blanked: after.blanked }),
    };
  }
  return { error: "the window kept changing, so no picture was taken." };
}

/** What is left out, each tab once. */
function hiddenParts({ blanked, look, shows }: Looked): HiddenPart[] {
  const parts = shows.flatMap(({ hidden }) =>
    hidden === undefined ? [] : [hidden],
  );
  const sidesBlanked = shows.filter((each) => each.hidden).length;
  return [
    ...parts.filter(
      (part, index) =>
        parts.findIndex((each) => each.tab === part.tab) === index,
    ),
    ...(blanked.length > sidesBlanked && look.pictures.length > 0
      ? [{ why: "pictures of files you can't read" }]
      : []),
  ];
}

/** What became of a side: shown, or why not. */
interface Shows {
  /** The document a page is on, for telling whether it changed; its frames come and go, each judged at each reading. */
  document?: string;
  hidden?: HiddenPart;
}

interface Looked {
  /** The parts blanked. */
  blanked: WindowBox[];
  look: WindowLook;
  shows: Shows[];
}

/** Whether two readings of a window have the same things in the same places. */
function isSameWindow(one: Looked, other: Looked): boolean {
  return (
    isEqual(one.blanked, other.blanked) &&
    isEqual(one.look.sides.map(identity), other.look.sides.map(identity)) &&
    isEqual(
      one.shows.map(({ document, hidden }) => [document, hidden?.why]),
      other.shows.map(({ document, hidden }) => [document, hidden?.why]),
    )
  );
}

/** A side without its tab's title, which a page or a chat changes as it likes. */
function identity({ box, root, tab }: WindowSide) {
  return [box, tab.id, tab.kind, root, addressOf(tab)];
}

/** A website's address is its page's to change; its documents are what count. */
function addressOf(tab: LayoutTab) {
  return tab.kind === "website" ? "" : tab.address;
}

async function decide(look: WindowLook, reading: Reading): Promise<Shows[]> {
  return Promise.all(look.sides.map((side) => sideShows(side, reading)));
}

/** A page, by every document in it: a frame can show what its page does not. */
async function pageShows(tabId: string, reading: Reading): Promise<Shows> {
  const hidden = (why: string) => ({ tab: tabId, why });
  const shows = await reading.camera.pageShows(tabId);
  if (!shows) {
    return { hidden: hidden("what it shows can't be told") };
  }
  const { documents, isSigningIn } = shows;
  const [document] = documents;
  if (document === undefined) {
    return { hidden: hidden("what it shows can't be told") };
  }
  if (isSigningIn) {
    return { document, hidden: hidden("a sign-in is up on it") };
  }
  const isOpen = (url: string) => {
    let scheme: string;
    try {
      scheme = new URL(url).protocol;
    } catch {
      return false;
    }
    return scheme === "file:"
      ? agentPathOfFileUrl(reading.layout, url) !== null
      : ["about:", "blob:", "data:", "http:", "https:"].includes(scheme);
  };
  return documents.every(isOpen)
    ? { document }
    : {
        document,
        hidden: hidden("it shows a file or an extension you can't read"),
      };
}

async function sideShows(
  { root, tab }: WindowSide,
  reading: Reading,
): Promise<Shows> {
  const { layout } = reading;
  const shown: Shows = {};
  const hidden = (why: string): Shows => ({ hidden: { tab: tab.id, why } });
  switch (tab.kind) {
    // Every chat's records are the agent's to read, its pictures held to
    // the folders apart (`isPictureOpen`).
    case "chat":
    case "newChat":
      return shown;
    case "website":
      return pageShows(tab.id, reading);
    case "file":
      return agentPathOfHostFile(layout, tab.address) === null
        ? hidden("a file outside your folders")
        : shown;
    case "folder":
      return isFolderOpen(tab.address, root, layout)
        ? shown
        : hidden("a folder you can't read all of");
    case "builtIn":
      return SHOWN_PAGES.has(tab.address) || SHOWN_HOSTS.test(tab.address)
        ? shown
        : hidden("a page of Instrument's own you can't see");
  }
}

/**
 * Whether everything a folder's view can draw is the chat's to read: the
 * folder with nothing closed anywhere in it, since a list opens folders in
 * place, and the names in each folder above it up to where the view starts,
 * which columns show.
 */
function isFolderOpen(
  folder: string,
  root: string | undefined,
  layout: WorkspaceFsLayout,
): boolean {
  if (agentPathOfHostFile(layout, folder) === null || root === undefined) {
    return false;
  }
  const above = foldersDown(root, folder);
  return (
    above !== undefined &&
    above.every(
      (each) => reachOf(layout.rules, each, "list").level === "allow",
    ) &&
    !layout.rules.rules.some(
      (rule) =>
        (rule.level === "ask" || rule.level === "never") &&
        // Files lists nothing of the app's own data.
        rule.appData !== true &&
        hostPathWithin(folder, rule.path) !== null,
    )
  );
}

/** `root`, and each folder from it down to `folder`; nothing where that is not in it. */
function foldersDown(root: string, folder: string): string[] | undefined {
  if (hostPathWithin(root, folder) === null) {
    return undefined;
  }
  const folders = [folder];
  for (
    let at = folder;
    hostPathWithin(root, path.dirname(at)) !== null && path.dirname(at) !== at;
    at = path.dirname(at)
  ) {
    folders.push(path.dirname(at));
  }
  return folders;
}

/** The pages of the sides the chat may not read, and the pictures of files it may not read wherever they are drawn. */
function blankedBoxes(
  look: WindowLook,
  shows: readonly Shows[],
  layout: WorkspaceFsLayout,
): WindowBox[] {
  return [
    ...look.sides.flatMap((side, index) =>
      shows[index]?.hidden === undefined ? [] : [side.box],
    ),
    ...look.pictures.flatMap((picture) =>
      (picture.side !== undefined &&
        shows[picture.side]?.hidden !== undefined) ||
      isPictureOpen(picture, look.sides[picture.side ?? -1], layout)
        ? []
        : [picture.box],
    ),
  ];
}

/**
 * Whether a picture may be shown. A reply can name any file on the computer
 * as a picture, and the window draws it for the person whether or not the
 * chat may read it. One whose source can't be told is shown only as an icon
 * or in a file's own viewer, which draws the file the side already shows.
 */
function isPictureOpen(
  picture: WindowLook["pictures"][number],
  side: undefined | WindowSide,
  layout: WorkspaceFsLayout,
): boolean {
  if (picture.file !== undefined) {
    return agentPathOfHostFile(layout, picture.file) !== null;
  }
  return picture.isIcon || side?.tab.kind === "file";
}
