import type { Protocol } from "devtools-protocol";
import type { DownloadItem, Session, WebContents } from "electron";

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import type { BrowserEntry } from "./entry";

import { trackDownload } from "./download-list";
import { type GuestRegistry } from "./guest-registry";
import { isAllowedLocalDownload } from "./local-file-policy";

/**
 * The part of `Browser.setDownloadBehavior` an agent's downloads follow. A
 * folder that is not absolute would be read against this process's own
 * working folder, so it allows nothing.
 */
const DownloadBehaviorSchema = z.object({
  behavior: z.enum(["allow", "allowAndName", "default", "deny"]),
  downloadPath: z
    .string()
    .refine((folder) => path.isAbsolute(folder))
    .optional(),
});

export function applyDownloadBehavior(
  entry: BrowserEntry,
  params: unknown,
): Record<string, never> {
  const parsed = DownloadBehaviorSchema.safeParse(params);
  entry.authorizedDownloadPath =
    parsed.success &&
    (parsed.data.behavior === "allow" ||
      parsed.data.behavior === "allowAndName")
      ? (parsed.data.downloadPath ?? null)
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
// authorized via setDownloadBehavior, the file lands there under the GUID as
// filename (what agent-browser's `download` command expects from
// "allowAndName"), with a fresh GUID when no downloadWillBegin captured one.
// Without one, the download is the person's own, from a click in the browser
// panel, and lands in their Downloads folder under its own name, or wherever
// they say when that folder takes no file. Only a download from a contents no
// tab's entry owns is canceled. One the person picked Save Image As… for asks
// them where it goes, whatever the agent authorized.
export function routeGuestDownloads(
  session: Session,
  registry: Pick<GuestRegistry, "documentOf" | "entryOf">,
) {
  session.on("will-download", (_event, item, webContents) => {
    const entry = registry.entryOf(webContents.id);
    if (!entry) {
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
    if (takeAskedSave(webContents.id, item)) {
      askWhereToSave(item);
    } else if (entry.authorizedDownloadPath) {
      saveForAgent(entry, item, entry.authorizedDownloadPath, stillOwned);
    } else {
      saveForPerson(item);
    }
  });
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
// canceled at once, so agent-browser's `download` errors now rather than
// waiting out its timeout for an event that never comes.
function refuseForAgent(entry: BrowserEntry, item: DownloadItem) {
  const guid =
    entry.pendingDownloadGuids.get(item.getURL()) ?? crypto.randomUUID();
  entry.pendingDownloadGuids.delete(item.getURL());
  entry.authorizedDownloadPath = null;
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
function saveForAgent(
  entry: BrowserEntry,
  item: DownloadItem,
  authorizedDownloadPath: string,
  stillOwned: () => boolean,
) {
  const { targetId } = entry;

  const guid =
    entry.pendingDownloadGuids.get(item.getURL()) ?? crypto.randomUUID();
  entry.pendingDownloadGuids.delete(item.getURL());
  item.setSavePath(`${authorizedDownloadPath}/${guid}`);

  // Synthesize Page.downloadWillBegin so agent-browser's download command
  // can capture the GUID and start waiting for completion.
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
      return;
    }
    // The authorization was for this one transfer: agent-browser sends a
    // fresh setDownloadBehavior ahead of every `download` and never rescinds
    // one, so left in place it would claim the person's next click on this
    // guest too, saving it under a GUID where they cannot find it.
    entry.authorizedDownloadPath = null;
    // Synthesize Page.downloadProgress so agent-browser resolves or errors.
    const progress: Protocol.Browser.DownloadProgressEvent = {
      guid,
      receivedBytes: item.getReceivedBytes(),
      state: state === "completed" ? "completed" : "canceled",
      totalBytes: item.getTotalBytes(),
    };
    for (const listener of entry.eventListeners) {
      listener("Page.downloadProgress", progress);
    }
  });
}

// No save path and no cancel is what puts the system's question up.
function askWhereToSave(item: DownloadItem) {
  item.setSaveDialogOptions({ defaultPath: item.getFilename() });
  trackDownload(item, null, { asked: true });
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
function saveForPerson(item: DownloadItem) {
  const dir = personDownloadsDir();
  if (!dir) {
    askWhereToSave(item);
    return;
  }
  const savePath = path.join(dir, availableFilename(dir, item.getFilename()));
  item.setSavePath(savePath);
  trackDownload(item, savePath);
}
