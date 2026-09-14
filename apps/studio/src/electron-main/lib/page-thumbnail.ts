import { BrowserWindow, session } from "electron";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { sleep } from "radashi";

import { confineLocalPagesToTheirFolder } from "../browser-view/local-file-policy";
import { createScopedLogger } from "./electron-logger";

const log = createScopedLogger("PageThumbnail");

/**
 * A page's file drawn as its page, for the file browser to stand beside a
 * selected file the way it stands a document's text there: the file is loaded
 * in a window nobody sees and photographed.
 *
 * A picture rather than a live frame, on purpose. The person's file channel
 * may not load a page as a document, since a page can read its own address
 * and the channel's token with it, and a `file://` page in the app's own
 * session reads the whole disk. So the page is loaded where the browser
 * guests load one: at its `file://` address, in a session of its own under
 * the same rule (a local page reads only its own folder), with no input, no
 * popups, no navigation of its own, and no sound. What comes out is an image,
 * which a page cannot use to reach anything.
 *
 * One window, made when a picture is asked for and let go once nothing has
 * been for a while, and one picture at a time in the order asked, since a
 * window shows one page. The last picture of each file is kept by the file's
 * mtime, so selecting a file again costs nothing until it is written.
 */

/** The page laid out at a laptop's width, in the shape of the box it is drawn in. */
const VIEWPORT = { height: 1312, width: 1024 };
const LOAD_TIMEOUT_MS = 6000;
/** The room a deferred script has to draw after the load event, and fonts to arrive. */
const SETTLE_MS = 300;
const SETTLE_TIMEOUT_MS = 1500;
const IDLE_CLOSE_MS = 15_000;
const CACHE_MAX = 24;

/** Resolves once the page's fonts are in and a frame has been drawn with them. */
const SETTLE_SCRIPT = `document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))).then(() => undefined)`;

interface Thumbnail {
  dataUrl: string;
  modifiedAt: number;
}

const cache = new Map<string, Thumbnail>();

let sessionReady = false;

/**
 * The session a page is photographed in: nothing persists, nothing is granted,
 * and a local page reaches its own folder and nothing else, as in a guest.
 */
function thumbnailSession() {
  const thumbnails = session.fromPartition("page-thumbnail");
  if (!sessionReady) {
    sessionReady = true;
    thumbnails.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false);
    });
    thumbnails.setPermissionCheckHandler(() => false);
    confineLocalPagesToTheirFolder(thumbnails);
  }
  return thumbnails;
}

let window: BrowserWindow | null = null;
let idleClose: ReturnType<typeof setTimeout> | undefined;

function releaseWindowLater() {
  if (idleClose) {
    clearTimeout(idleClose);
  }
  idleClose = setTimeout(() => {
    idleClose = undefined;
    if (window && !window.isDestroyed()) {
      window.destroy();
    }
    window = null;
  }, IDLE_CLOSE_MS);
}

function windowForCapture() {
  if (idleClose) {
    clearTimeout(idleClose);
    idleClose = undefined;
  }
  if (window && !window.isDestroyed()) {
    return window;
  }
  window = new BrowserWindow({
    focusable: false,
    height: VIEWPORT.height,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      // A hidden window's timers are otherwise slowed, and the deferred
      // scripts a page draws with would not have run by the time it is
      // photographed.
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: thumbnailSession(),
      webSecurity: true,
    },
    width: VIEWPORT.width,
  });
  const contents = window.webContents;
  contents.setAudioMuted(true);
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  // The page is put where it is by the load below and goes nowhere of its own:
  // a redirecting page has nothing to show, and a page sending itself to
  // another file would be the file it names.
  contents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  window.on("closed", () => {
    window = null;
  });
  return window;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * The page at `hostPath` as a PNG data URL, as the file is now. Throws when
 * the file is not there or the page could not be drawn; the caller's signal
 * lets a request no one is waiting for any more be skipped in the queue.
 */
export async function capturePageThumbnail(
  hostPath: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<Thumbnail> {
  const stats = await fs.stat(hostPath);
  const cached = cache.get(hostPath);
  if (cached && cached.modifiedAt === stats.mtimeMs) {
    return cached;
  }
  const turn = queue.then(async () => {
    if (signal?.aborted) {
      throw new Error("The thumbnail is no longer wanted");
    }
    return capture(hostPath, stats.mtimeMs);
  });
  // The queue moves on whether or not this one drew.
  queue = turn.catch(() => {});
  return turn;
}

async function capture(hostPath: string, modifiedAt: number) {
  const contents = windowForCapture().webContents;
  try {
    const load = contents.loadURL(pathToFileURL(hostPath).href);
    // A load still going when the picture is taken can fail after it, with
    // nothing waiting to hear so.
    load.catch(() => {});
    const loaded = await Promise.race([
      load.then(() => true),
      sleep(LOAD_TIMEOUT_MS).then(() => false),
    ]);
    // Whatever the page has managed to draw is the picture, when it is still
    // waiting on something; that picture is not kept, so the next ask tries
    // again.
    if (loaded) {
      await Promise.race([
        contents.executeJavaScript(SETTLE_SCRIPT, true).catch(() => {}),
        sleep(SETTLE_TIMEOUT_MS),
      ]);
      await sleep(SETTLE_MS);
    }
    const image = await contents.capturePage();
    if (image.isEmpty()) {
      throw new Error("The page drew nothing");
    }
    // The window is laid out in points and photographed in pixels, so on a
    // dense display the picture is twice the page; the box it is drawn in is
    // far smaller than the page either way.
    const png = image.resize({ width: VIEWPORT.width }).toPNG();
    const thumbnail = {
      dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      modifiedAt,
    };
    if (loaded) {
      remember(hostPath, thumbnail);
    }
    return thumbnail;
  } catch (error) {
    log.warn(`Could not draw ${hostPath}: ${String(error)}`);
    throw error;
  } finally {
    // Let the page go rather than leave its scripts running unseen.
    if (!contents.isDestroyed()) {
      void contents.loadURL("about:blank").catch(() => {});
    }
    releaseWindowLater();
  }
}

function remember(hostPath: string, thumbnail: Thumbnail) {
  cache.delete(hostPath);
  cache.set(hostPath, thumbnail);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
}
