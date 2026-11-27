import type { Protocol } from "devtools-protocol";
import type { DownloadItem, Session, WebContents } from "electron";

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import type { BrowserEntry } from "./entry";

import { publisher } from "@/electron-main/rpc/publisher";
import {
  agentDownloadsFolder,
  notePageDownload,
} from "@instrument-org/workspace/electron";

import { type DownloadOrigin, trackDownload } from "./download-list";
import { markFromInternet } from "../lib/download-mark";
import { type GuestRegistry, guests } from "./guest-registry";
import { isAllowedLocalDownload } from "./local-file-policy";
import { log } from "./log";

/**
 * The part of `Browser.setDownloadBehavior` an agent's downloads follow. A
 * folder that is not absolute would be read against this process's own
 * working folder, so it allows nothing. `fileName` is this app's own
 * addition, which the agent's `download` command sends: the name the file
 * is saved under in the folder, a bare name and nothing more.
 */
const DownloadBehaviorSchema = z.object({
  behavior: z.enum(["allow", "allowAndName", "default", "deny"]),
  downloadPath: z
    .string()
    .refine((folder) => path.isAbsolute(folder))
    .optional(),
  fileName: z
    .string()
    .refine(
      (name) =>
        name !== "." &&
        name !== ".." &&
        name !== "" &&
        !/[\\/]/.test(name) &&
        !name.includes("\0"),
    )
    .optional(),
});

export function applyDownloadBehavior(
  entry: BrowserEntry,
  params: unknown,
): Record<string, never> {
  const parsed = DownloadBehaviorSchema.safeParse(params);
  const allowed =
    parsed.success &&
    (parsed.data.behavior === "allow" ||
      parsed.data.behavior === "allowAndName");
  entry.authorizedDownloadAt = Date.now();
  entry.authorizedDownloadPath = allowed
    ? (parsed.data.downloadPath ?? null)
    : null;
  entry.authorizedDownloadName = allowed
    ? (parsed.data.fileName ?? null)
    : null;
  return {};
}

// The addresses a person picked Save Image As… (or Video, or Audio) for in a
// page's menu, by the id of the guest the menu was raised in. Each is taken by
// the download it starts.
const askedSaves = new Map<number, Set<string>>();

/**
 * Downloads `url` from the guest the way a browser's Save Image As… does:
 * through the session's `will-download` like any other download, so it goes
 * on the download list, but asking the person where to put it.
 */
export function saveAsFromPage(guest: WebContents, url: string) {
  const urls = askedSaves.get(guest.id) ?? new Set<string>();
  urls.add(url);
  askedSaves.set(guest.id, urls);
  guest.downloadURL(url);
}

// Whether the download is one the person asked to save as, which it then
// stops being. A redirect leaves the address asked for first in the chain.
function takeAskedSave(webContentsId: number, item: DownloadItem) {
  const urls = askedSaves.get(webContentsId);
  if (!urls) {
    return false;
  }
  const url = [item.getURLChain()[0], item.getURL()].find(
    (candidate) => candidate !== undefined && urls.has(candidate),
  );
  if (url === undefined) {
    return false;
  }
  urls.delete(url);
  if (urls.size === 0) {
    askedSaves.delete(webContentsId);
  }
  return true;
}

// The guest session's one will-download listener. Every guest shares the
// session, so the event names only the contents a download came from, and the
// guest registry says which tab's entry that is. With a path the agent
// authorized via setDownloadBehavior, the file lands there under the name the
// agent gave, and goes on the download list beside the person's own;
// without a name, under the GUID as filename (what agent-browser's own
// `download` command expects from "allowAndName"), with a fresh GUID when no
// downloadWillBegin captured one.
// Without one, the download is the person's own, from a click in the browser
// panel, and lands in their Downloads folder under its own name, or wherever
// they say when that folder takes no file. Only a download from a contents no
// tab's entry owns is canceled. One the person picked Save Image As… for asks
// them where it goes, whatever the agent authorized. Every finished download
// carries the system's downloaded-from-the-internet mark, as a browser's does,
// so a link from outside reveals a page saved here rather than opening it; a
// mark that cannot be written leaves the download as it is. The agent hears
// its download finished only once the mark is written or has failed (and
// never from Chromium itself, see {@link holdsDownloadEvent}), since
// agent-browser moves the file off its GUID name the moment it hears, and a
// rename keeps the mark where a write after it finds no file.
//
// The agent's authorization covers a download only while no person has used
// the guest since it was given: a click of the agent's that starts no download
// leaves it in place, and the person's own click afterwards is theirs. A
// download with no authorization that starts soon after an agent's command
// in the guest, with no person's input since, is the agent's too, as a plain
// click on a download link is: it lands in the downloads folder of the chat
// driving the tab (`agentFolderOf`) under its own name, goes on the list as
// the agent's, and is named in that session's next result. A
// person's download from a guest that never committed a page leaves its tab
// with nothing to show, and `pageBecameDownload` says so once the file has a
// place, or the person declined to give it one, as Chromium's
// `DownloadUIController` closes such a tab.
export function routeGuestDownloads(
  session: Session,
  registry: Pick<GuestRegistry, "documentOf" | "entryOf" | "get">,
  {
    agentFolderOf = agentDownloadsFolder,
    markDownloaded = markFromInternet,
    noteAgentDownload = notePageDownload,
    pageBecameDownload = (targetId) => {
      publisher.publish("browser.page-became-download", { targetId });
    },
  }: {
    agentFolderOf?: (targetId: BrowserEntry["targetId"]) => string | undefined;
    markDownloaded?: (file: string) => Promise<void>;
    noteAgentDownload?: typeof notePageDownload;
    pageBecameDownload?: (targetId: BrowserEntry["targetId"]) => void;
  } = {},
) {
  session.on("will-download", (_event, item, webContents) => {
    logDownload(item);
    // Settles once the download is done and, when it completed, its mark is
    // written or could not be.
    const marked = new Promise<void>((resolve) => {
      item.once("done", (_doneEvent, state) => {
        if (state !== "completed") {
          resolve();
          return;
        }
        markDownloaded(item.getSavePath())
          .catch((error: unknown) => {
            log.warn(
              "Left a finished download without its download mark",
              error,
            );
          })
          .finally(resolve);
      });
    });
    // A download the person asked for again from the list comes from the
    // session rather than a page, so it is theirs whatever page is open.
    if (takeRetry(item)) {
      log.info(`download for=retry ${describeDownload(item)}`);
      saveForPerson(item, null);
      return;
    }
    // So is one an extension asked for, from its own page or the session.
    const extensionAsk = takeExtensionAsk(item);
    if (extensionAsk) {
      log.info(
        `download for=extension ${extensionAsk.extensionId} ${describeDownload(item)}`,
      );
      extensionAsk.started(saveForExtension(item, extensionAsk));
      return;
    }
    const entry = registry.entryOf(webContents.id);
    if (!entry) {
      log.info(
        `download refused from=${registry.get(webContents.id)?.role ?? "unknown"} ${describeDownload(item)}`,
      );
      item.cancel();
      return;
    }
    if (
      /^file:/i.test(item.getURL()) &&
      !isAllowedLocalDownload(
        item.getURL(),
        registry.documentOf(webContents.id, webContents.mainFrame),
      )
    ) {
      log.info(`download refused local file targetId=${entry.targetId}`);
      item.cancel();
      if (entry.authorizedDownloadPath) {
        refuseForAgent(entry, item);
      }
      return;
    }
    const stillOwned = () => registry.entryOf(webContents.id) === entry;
    entry.downloadsRunning += 1;
    item.once("done", () => {
      entry.downloadsRunning -= 1;
    });
    const record = registry.get(webContents.id);
    const pressed = record?.pressedAt;
    const origin: DownloadOrigin = {
      targetId: entry.targetId,
      ...(pressed && Date.now() - pressed.at < PRESS_STARTS_DOWNLOAD_MS
        ? { x: pressed.x, y: pressed.y }
        : {}),
    };
    const usedSinceAuthorized =
      (record?.userInputAt ?? 0) > entry.authorizedDownloadAt;
    // Chromium's test is the guest's alone: whatever opened the tab, a
    // download is all its first navigation did.
    const leftNothing = record !== undefined && !record.committed;
    const onceItHasAPlace = () => {
      if (leftNothing) {
        whenPlaced(item, () => {
          pageBecameDownload(entry.targetId);
        });
      }
    };
    const agentStartedIt =
      Date.now() - entry.lastAgentCommandAt < PRESS_STARTS_DOWNLOAD_MS &&
      (record?.userInputAt ?? 0) <= entry.lastAgentCommandAt;
    const agentFolder = agentStartedIt
      ? agentFolderOf(entry.targetId)
      : undefined;
    const owner = takeAskedSave(webContents.id, item)
      ? "asked"
      : entry.authorizedDownloadPath && !usedSinceAuthorized
        ? "agent"
        : agentFolder === undefined
          ? "person"
          : "agent-page";
    log.info(
      `download for=${owner} targetId=${entry.targetId} committed=${String(!leftNothing)} ${describeDownload(item)}`,
    );
    if (owner === "asked") {
      askWhereToSave(item, origin);
      onceItHasAPlace();
    } else if (owner === "agent" && entry.authorizedDownloadPath) {
      saveForAgent(entry, item, {
        authorizedDownloadPath: entry.authorizedDownloadPath,
        marked,
        origin,
        stillOwned,
      });
    } else if (owner === "agent-page" && agentFolder !== undefined) {
      saveForAgentPage(entry, item, {
        folder: agentFolder,
        noteAgentDownload,
        origin,
      });
    } else {
      saveForPerson(item, origin);
      onceItHasAPlace();
    }
  });
}

// A download the agent's own click or navigation started, with no folder
// authorized for it: saved in the chat's downloads folder under its own name,
// numbered as a browser numbers one when the name is taken, listed as the
// agent's, and told to the session driving the tab as it begins and ends.
// A folder that cannot be made sends it to the person's place instead.
function saveForAgentPage(
  entry: BrowserEntry,
  item: DownloadItem,
  {
    folder,
    noteAgentDownload,
    origin,
  }: {
    folder: string;
    noteAgentDownload: typeof notePageDownload;
    origin: DownloadOrigin;
  },
) {
  try {
    fs.mkdirSync(folder, { recursive: true });
  } catch (error) {
    log.warn("Could not make the agent's downloads folder", error);
    saveForPerson(item, origin);
    return;
  }
  const savePath = path.join(
    folder,
    browserAvailableFilename(folder, item.getFilename()),
  );
  item.setSavePath(savePath);
  trackDownload(item, savePath, { agent: true, origin });
  const id = crypto.randomUUID();
  noteAgentDownload(entry.targetId, id, { path: savePath, state: "running" });
  item.once("done", (_event, state) => {
    noteAgentDownload(entry.targetId, id, {
      path: savePath,
      state:
        state === "completed"
          ? "completed"
          : state === "cancelled"
            ? "canceled"
            : "failed",
    });
  });
}

// A browser's convention for a name already taken in a folder: `report (1).csv`,
// `report (2).csv`, and so on, done synchronously since the save path has to
// be set before the will-download handler returns.
function browserAvailableFilename(dir: string, filename: string): string {
  const taken = (candidate: string) => fs.existsSync(path.join(dir, candidate));
  if (!taken(filename)) {
    return filename;
  }
  const ext = path.extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;
  let suffix = 1;
  while (taken(`${stem} (${suffix})${ext}`)) {
    suffix += 1;
  }
  return `${stem} (${suffix})${ext}`;
}

// Runs `then` once the download has a place on disk, or ended without one:
// at once for a save path set before the handler returns, otherwise once the
// system's question is answered and the transfer moves or stops.
function whenPlaced(item: DownloadItem, then: () => void) {
  if (item.getSavePath()) {
    then();
    return;
  }
  let ran = false;
  const once = () => {
    if (!ran) {
      ran = true;
      then();
    }
  };
  item.once("updated", once);
  item.once("done", once);
}

// A download's host and nothing more of its address, which can carry tokens
// and says what the person was looking at.
function describeDownload(item: DownloadItem) {
  const hostOf = (url: string | undefined) =>
    URL.parse(url ?? "")?.host || "unknown";
  const first = hostOf(item.getURLChain()[0]);
  const last = hostOf(item.getURL());
  return `host=${first}${last === first ? "" : ` via=${last}`}`;
}

// Every download's end goes in the log, whoever it was for.
function logDownload(item: DownloadItem) {
  item.once("done", (_event, state) => {
    log.info(
      `download ${state} received=${String(item.getReceivedBytes())} total=${String(item.getTotalBytes())} ${describeDownload(item)}`,
    );
  });
}

/**
 * How soon after a press in a page a download it starts still counts as the
 * press's: a link's download begins once its response arrives, which a slow
 * server can hold for a while.
 */
const PRESS_STARTS_DOWNLOAD_MS = 10_000;

// The addresses a person asked to download again from the list. Each is taken
// by the download it starts.
const retries = new Set<string>();

function takeRetry(item: DownloadItem): boolean {
  return [item.getURLChain()[0], item.getURL()].some(
    (url) => url !== undefined && retries.delete(url),
  );
}

/** What an extension asked of a download (`chrome.downloads.download`). */
export interface ExtensionDownloadAsk {
  conflictAction: "overwrite" | "prompt" | "uniquify";
  extensionId: string;
  /** A path below the Downloads folder, already checked to stay there. */
  filename?: string;
  saveAs: boolean;
  /** Called with the download's id on the list once it starts. */
  started: (id: string) => void;
}

// The downloads extensions asked for, by address. Each is taken by the
// download it starts.
const extensionAsks = new Map<string, ExtensionDownloadAsk[]>();

function takeExtensionAsk(
  item: DownloadItem,
): ExtensionDownloadAsk | undefined {
  for (const url of [item.getURLChain()[0], item.getURL()]) {
    const asks = url === undefined ? undefined : extensionAsks.get(url);
    const ask = asks?.shift();
    if (url !== undefined && asks?.length === 0) {
      extensionAsks.delete(url);
    }
    if (ask) {
      return ask;
    }
  }
  return undefined;
}

/**
 * Downloads an address an extension asked for, from `starter` (the
 * extension's own page, for a `blob:` address only it can read, or the
 * session), the way a person's download goes: onto the list, into their
 * Downloads folder. Returns what takes the ask back, for one that never
 * started.
 */
export function downloadForExtension(
  starter: Pick<Session | WebContents, "downloadURL">,
  url: string,
  headers: Record<string, string>,
  ask: ExtensionDownloadAsk,
): () => void {
  extensionAsks.set(url, [...(extensionAsks.get(url) ?? []), ask]);
  starter.downloadURL(
    url,
    Object.keys(headers).length > 0 ? { headers } : undefined,
  );
  return () => {
    const asks = extensionAsks.get(url)?.filter((other) => other !== ask);
    if (asks?.length) {
      extensionAsks.set(url, asks);
    } else {
      extensionAsks.delete(url);
    }
  };
}

// Where an extension's download goes: the person's Downloads folder, at the
// path below it the extension named, or wherever the person says when the
// extension asked for them to be asked, the name is taken and it said to
// ask, or no folder takes the file. Returns its id on the list.
function saveForExtension(item: DownloadItem, ask: ExtensionDownloadAsk) {
  const dir = personDownloadsDir();
  const wanted = path.join(dir ?? "", ask.filename ?? item.getFilename());
  const isTaken = fs.existsSync(wanted);
  const folder = path.dirname(wanted);
  const hasFolder =
    dir !== null &&
    (() => {
      try {
        fs.mkdirSync(folder, { recursive: true });
        return true;
      } catch {
        return false;
      }
    })();
  if (!hasFolder || ask.saveAs || (isTaken && ask.conflictAction === "prompt")) {
    item.setSaveDialogOptions({ defaultPath: wanted });
    return trackDownload(item, null, { asked: true });
  }
  const savePath =
    isTaken && ask.conflictAction === "uniquify"
      ? path.join(folder, availableFilename(folder, path.basename(wanted)))
      : wanted;
  item.setSavePath(savePath);
  return trackDownload(item, savePath);
}

/**
 * Downloads an address on the list again, as a browser's Retry does: into the
 * person's Downloads folder and onto the list. Only a web address, since a
 * page's own file is only ever downloaded from that page. Says whether it
 * started.
 *
 * Chromium's Retry sends the request as the original one's initiator rather
 * than the downloads page's, which a site that checks where a request came
 * from needs. Electron offers no initiator, so the retry starts from the
 * tab the download came from (`from`) while its guest is still open, and
 * from the session alone otherwise.
 */
export function retryDownloadFrom(
  session: Session,
  url: string,
  from?: string,
  registry: Pick<GuestRegistry, "records"> = guests,
): boolean {
  if (!/^https?:/i.test(url)) {
    return false;
  }
  retries.add(url);
  const page =
    from === undefined
      ? undefined
      : [...registry.records()].find(
          (record) =>
            record.entry?.targetId === from && !record.contents.isDestroyed(),
        );
  if (page) {
    page.contents.downloadURL(url);
  } else {
    session.downloadURL(url);
  }
  return true;
}

// Capture the GUID from Page.downloadWillBegin so will-download can
// save with the GUID filename that agent-browser expects to find.
export function captureDownloadWillBeginGuid(
  entry: BrowserEntry,
  params: unknown,
) {
  const p = params as Protocol.Browser.DownloadWillBeginEvent;
  if (p.guid && p.url) {
    entry.pendingDownloadGuids.set(p.url, p.guid);
  }
}

/**
 * Whether an event of the guest's debugger is Chromium's own word that one of
 * the agent's downloads finished, which goes no further: Chromium says so
 * before the download's `done`, and agent-browser moves the file the moment
 * it hears, so only the `Page.downloadProgress` {@link routeGuestDownloads}
 * sends once the file is marked may tell it.
 */
export function holdsDownloadEvent(
  entry: BrowserEntry,
  method: string,
  params: unknown,
): boolean {
  if (method !== "Page.downloadProgress") {
    return false;
  }
  // Chromium's own event, so its shape is the protocol's.
  const { guid, state } = params as Protocol.Page.DownloadProgressEvent;
  return state !== "inProgress" && entry.agentDownloads.has(guid);
}

// `findAvailableName`'s convention, done synchronously: the save path has to
// be set before the will-download handler returns.
function availableFilename(dir: string, filename: string): string {
  const taken = (candidate: string) => fs.existsSync(path.join(dir, candidate));
  if (!taken(filename)) {
    return filename;
  }
  const ext = path.extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;
  let suffix = 2;
  while (taken(`${stem}-${suffix}${ext}`)) {
    suffix += 1;
  }
  return `${stem}-${suffix}${ext}`;
}

// The person's own Downloads folder, proved writable before it is chosen.
// Writing there is the first thing that can fail: macOS asks once before an
// app may touch Downloads and remembers a refusal, and a platform can have no
// Downloads folder at all. Proving it by writing and removing a file is also
// what raises the system's question at the moment it makes sense, on the
// click. Null when it takes no file, and then the person is asked where to
// put it.
function personDownloadsDir(): null | string {
  try {
    const dir = app.getPath("downloads");
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.instrument-write-probe-${process.pid}`);
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
    return dir;
  } catch {
    return null;
  }
}

// A download the agent asked for and the page may not make: told as begun and
// canceled at once, so the agent's `download` errors now rather than
// waiting out its timeout for an event that never comes.
function refuseForAgent(entry: BrowserEntry, item: DownloadItem) {
  const guid =
    entry.pendingDownloadGuids.get(item.getURL()) ?? crypto.randomUUID();
  entry.pendingDownloadGuids.delete(item.getURL());
  entry.authorizedDownloadPath = null;
  entry.authorizedDownloadName = null;
  const willBegin: Protocol.Browser.DownloadWillBeginEvent = {
    frameId: entry.targetId,
    guid,
    suggestedFilename: item.getFilename(),
    url: item.getURL(),
  };
  const progress: Protocol.Browser.DownloadProgressEvent = {
    guid,
    receivedBytes: 0,
    state: "canceled",
    totalBytes: 0,
  };
  for (const listener of entry.eventListeners) {
    listener("Page.downloadWillBegin", willBegin);
    listener("Page.downloadProgress", progress);
  }
}

// `stillOwned` says whether the guest the download came from is still this
// entry's when it finishes; a guest gone by then has nobody left to tell.
// `marked` settles once the finished file carries its download mark, or the
// mark failed. A download the agent named goes on the download list, where
// the person sees it beside their own and opens it where it was saved.
function saveForAgent(
  entry: BrowserEntry,
  item: DownloadItem,
  {
    authorizedDownloadPath,
    marked,
    origin,
    stillOwned,
  }: {
    authorizedDownloadPath: string;
    marked: Promise<void>;
    origin: DownloadOrigin;
    stillOwned: () => boolean;
  },
) {
  const { targetId } = entry;

  const guid =
    entry.pendingDownloadGuids.get(item.getURL()) ?? crypto.randomUUID();
  entry.pendingDownloadGuids.delete(item.getURL());
  const name = entry.authorizedDownloadName;
  const savePath =
    name === null
      ? `${authorizedDownloadPath}/${guid}`
      : path.join(authorizedDownloadPath, name);
  item.setSavePath(savePath);
  if (name !== null) {
    trackDownload(item, savePath, { agent: true, origin });
  }
  entry.agentDownloads.add(guid);

  // Synthesize Page.downloadWillBegin so the agent's `download` can capture
  // the GUID and start waiting for completion.
  const willBegin: Protocol.Browser.DownloadWillBeginEvent = {
    frameId: targetId,
    guid,
    suggestedFilename: item.getFilename(),
    url: item.getURL(),
  };
  for (const listener of entry.eventListeners) {
    listener("Page.downloadWillBegin", willBegin);
  }

  item.once("done", (_doneEvent, state) => {
    if (!stillOwned()) {
      entry.agentDownloads.delete(guid);
      return;
    }
    // The authorization was for this one transfer: the agent's `download`
    // sends a fresh setDownloadBehavior ahead of every click, so left in
    // place it would claim the person's next click on this guest too, saving
    // it in the agent's folder where they would not look.
    entry.authorizedDownloadPath = null;
    entry.authorizedDownloadName = null;
    // Synthesize Page.downloadProgress so the agent's `download` resolves or
    // errors.
    const progress: Protocol.Browser.DownloadProgressEvent = {
      guid,
      receivedBytes: item.getReceivedBytes(),
      state: state === "completed" ? "completed" : "canceled",
      totalBytes: item.getTotalBytes(),
    };
    void marked.then(() => {
      entry.agentDownloads.delete(guid);
      if (!stillOwned()) {
        return;
      }
      for (const listener of entry.eventListeners) {
        listener("Page.downloadProgress", progress);
      }
    });
  });
}

// No save path and no cancel is what puts the system's question up.
function askWhereToSave(item: DownloadItem, origin: DownloadOrigin | null) {
  item.setSaveDialogOptions({ defaultPath: item.getFilename() });
  trackDownload(item, null, { asked: true, origin });
}

// Where a download from any other browser goes, without a chooser: the
// person's Downloads folder, and onto the browser's download list, which the
// window shows. A name already taken gets the `-2`, `-3` suffix the rest of
// the app gives a copy, rather than overwriting, which is what an explicit
// save path otherwise does.
//
// When Downloads takes no file, the system asks where to put it, which is
// what leaving the save path unset means. The file is the person's, so the
// place is theirs to pick; what the app used to do instead was keep a
// `downloads` folder of its own at the top of the Instrument folder, where
// they had no reason to look.
function saveForPerson(item: DownloadItem, origin: DownloadOrigin | null) {
  const dir = personDownloadsDir();
  if (!dir) {
    askWhereToSave(item, origin);
    return;
  }
  const savePath = path.join(dir, availableFilename(dir, item.getFilename()));
  item.setSavePath(savePath);
  trackDownload(item, savePath, { origin });
}
