import { BrowserWindow, type NativeImage, session } from "electron";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { sleep } from "radashi";
import { type BundledLanguage, bundledLanguages } from "shiki";

import { isAllowedLocalRequest } from "../browser-view/local-file-policy";
import { createScopedLogger } from "./electron-logger";
import { extensionOf, renderedKindOf } from "./rendered-kinds";
import { getHighlighter } from "./shiki-highlighter";

const log = createScopedLogger("RenderedPictures");

/**
 * A file drawn by the app's own engine rather than the system's: a page's
 * file as a browser draws it, scripts and all, and a Markdown or code file as
 * the document it reads as, typeset and highlighted. The system's thumbnailer
 * runs no script, so a page that draws itself is a blank to it, and it has
 * nothing for Markdown or code on Windows and nothing at all on Linux; this
 * draws them the same way everywhere.
 *
 * A file is loaded into a window nobody sees and photographed. A page is
 * loaded where a browser guest loads one, at its `file://` address in a
 * session of its own under the guests' rule (a local page reads only its own
 * folder), with no input, popups, navigation or sound, and only the hosts a
 * page from the page skill draws its type and styles from. A document is
 * written out here as HTML whose policy lets nothing run and nothing load.
 * What comes out is a picture, which the page cannot use to reach anything.
 *
 * Always drawn light, the way paper is, so the picture does not depend on the
 * theme it happened to be drawn in and one kept picture serves both.
 */

/** A page laid out at a laptop's width, in a page's shape. */
const PAGE_VIEWPORT = { height: 1312, width: 1024 };
/** A document set as a sheet of paper, in the same shape. */
const DOCUMENT_VIEWPORT = { height: 1026, width: 800 };
/** The longer side of what comes out, in px: the largest size a thumbnail is asked for. */
const PICTURE_HEIGHT = 1024;
/** Windows drawn in at once; each holds one file. */
const WINDOWS = 2;
const LOAD_TIMEOUT_MS = 6000;
/** How long a photograph is waited for before the file is left to the system. */
const CAPTURE_TIMEOUT_MS = 4000;
/**
 * Whether the windows draw offscreen and hand over their frames as they
 * paint. On Linux a hidden window is an unmapped surface that the compositor
 * never gives a frame, so photographing one never answers; an offscreen
 * window paints without one. Elsewhere the hidden window is photographed,
 * which is the path measured on a Mac and on Windows.
 */
const OFFSCREEN = process.platform === "linux";
/**
 * How long an offscreen window is given to put a settled page into a frame:
 * the frames trail the page, and one taken straight after it settles was
 * measured blank or empty on the Linux test host, where 100ms was enough.
 */
const OFFSCREEN_SETTLE_MS = 150;
/** The room a page's deferred scripts have to draw once it has loaded and its fonts are in. */
const SETTLE_MS = 250;
const SETTLE_TIMEOUT_MS = 1500;
const IDLE_CLOSE_MS = 15_000;
/** How much of a file a document is set from; a thumbnail shows its first page. */
const READ_BYTES = 48 * 1024;
const CODE_LINES = 90;
/** A JSON file small enough to be parsed and laid out, when it came minified. */
const JSON_PRETTY_MAX = 2 * 1024 * 1024;

/**
 * The hosts a page from the page skill draws from: its web fonts and the
 * framework and icons it takes from jsDelivr. Everything else a page asks the
 * network for goes unanswered, so looking at a folder is not a page's cue to
 * call home.
 */
const PAGE_HOSTS = new Set([
  "cdn.jsdelivr.net",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);

/** Resolves once the page's fonts are in and a frame has been drawn with them. */
const SETTLE_SCRIPT = `document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))).then(() => undefined)`;

/**
 * The file drawn as its page or document, in a page's shape and
 * {@link PICTURE_HEIGHT} tall. Throws when the file cannot be read or drew
 * nothing; `complete` is false when a page was photographed before it had
 * finished loading, which is a picture worth showing but not keeping.
 */
export async function renderPicture(
  hostPath: string,
): Promise<{ complete: boolean; image: NativeImage }> {
  const kind = renderedKindOf(hostPath);
  if (!kind) {
    throw new Error(`${hostPath} is not a kind drawn here`);
  }
  const document =
    kind === "page" ? undefined : await documentOf(hostPath, kind);
  return withWindow(async (window) => {
    const viewport = kind === "page" ? PAGE_VIEWPORT : DOCUMENT_VIEWPORT;
    window.setContentSize(viewport.width, viewport.height);
    const contents = window.webContents;
    try {
      const load = contents.loadURL(
        document === undefined
          ? pathToFileURL(hostPath).href
          : `data:text/html;charset=utf-8,${encodeURIComponent(document)}`,
      );
      load.catch(() => {
        // A load still going when the picture is taken can fail after it,
        // with nothing waiting to hear so.
      });
      const loaded = await Promise.race([
        load.then(() => true),
        sleep(LOAD_TIMEOUT_MS).then(() => false),
      ]);
      if (loaded) {
        await Promise.race([
          contents.executeJavaScript(SETTLE_SCRIPT, true).catch(() => {
            // A page that refuses the script is photographed as it is.
          }),
          sleep(SETTLE_TIMEOUT_MS),
        ]);
        if (kind === "page") {
          await sleep(SETTLE_MS);
        }
      }
      const shot = await Promise.race([
        OFFSCREEN
          ? offscreenFrame(window)
          : contents.capturePage({
              height: viewport.height,
              width: viewport.width,
              x: 0,
              y: 0,
            }),
        sleep(CAPTURE_TIMEOUT_MS).then(() => {
          throw new Error("The file was not photographed in time");
        }),
      ]);
      if (shot.isEmpty()) {
        throw new Error("The file drew nothing");
      }
      // Laid out in points and photographed in pixels, so on a dense display
      // the shot is twice the layout; the picture is sized to what it is for.
      const image = shot.resize({
        height: PICTURE_HEIGHT,
        quality: "good",
        width: Math.round((PICTURE_HEIGHT * viewport.width) / viewport.height),
      });
      return { complete: loaded, image };
    } finally {
      // Let the page go rather than leave its scripts running unseen.
      if (!contents.isDestroyed()) {
        void contents.loadURL("about:blank").catch(() => {
          // The window may be on its way out, which is the same end.
        });
      }
    }
  });
}

/** The file set as a sheet of HTML that runs nothing and loads nothing. */
async function documentOf(hostPath: string, kind: "code" | "markdown") {
  const text = await readHead(hostPath);
  if (kind === "markdown") {
    // Loaded with the first document, not with the app.
    const { marked } = await import("marked");
    const body = await marked.parse(text, { async: true, gfm: true });
    return sheet("markdown", body);
  }
  const extension = extensionOf(hostPath);
  const code = extension === "json" ? await prettyJson(hostPath, text) : text;
  const lines = code
    .split(/\r?\n/)
    .slice(0, CODE_LINES)
    .map((line) => (line.length > 240 ? line.slice(0, 240) : line))
    .join("\n");
  const language = languageOf(extension);
  if (!language) {
    return sheet("code", `<pre><code>${escapeHtml(lines)}</code></pre>`);
  }
  const highlighter = await getHighlighter();
  if (!highlighter.getLoadedLanguages().includes(language)) {
    await highlighter.loadLanguage(bundledLanguages[language]);
  }
  return sheet(
    "code",
    highlighter.codeToHtml(lines, {
      lang: language,
      theme: "github-light-default",
    }),
  );
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function languageOf(extension: string): BundledLanguage | undefined {
  // Aliases (`ts`, `yml`, `py`) are keys of their own here.
  return extension in bundledLanguages
    ? (extension as BundledLanguage)
    : undefined;
}

/** A JSON file as it reads laid out, when it came on one line and is small enough to parse. */
async function prettyJson(hostPath: string, head: string) {
  if (head.split("\n", 3).length > 2) {
    return head;
  }
  try {
    const stats = await fs.stat(hostPath);
    if (stats.size > JSON_PRETTY_MAX) {
      return head;
    }
    const parsed: unknown = JSON.parse(await fs.readFile(hostPath, "utf8"));
    return JSON.stringify(parsed, null, 2);
  } catch {
    return head;
  }
}

async function readHead(hostPath: string) {
  const handle = await fs.open(hostPath, "r");
  try {
    const buffer = Buffer.alloc(READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, READ_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

const SHEET_STYLE = `
:root { color-scheme: light; }
html, body { margin: 0; background: #fff; color: #1c1917; }
body { overflow: hidden; -webkit-font-smoothing: antialiased; }
body.markdown { padding: 56px 64px; font: 17px/1.55 -apple-system, "Segoe UI", system-ui, sans-serif; }
body.markdown h1 { font-size: 2em; line-height: 1.2; margin: 0 0 0.5em; }
body.markdown h2 { font-size: 1.45em; line-height: 1.25; margin: 1.2em 0 0.4em; }
body.markdown h3 { font-size: 1.15em; margin: 1.1em 0 0.3em; }
body.markdown p, body.markdown ul, body.markdown ol, body.markdown blockquote, body.markdown table, body.markdown pre { margin: 0 0 0.9em; }
body.markdown ul, body.markdown ol { padding-left: 1.4em; }
body.markdown a { color: #0b6056; }
body.markdown code { font: 0.88em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #f5f5f4; border-radius: 4px; padding: 0.1em 0.3em; }
body.markdown pre { background: #f5f5f4; border-radius: 8px; padding: 14px 16px; white-space: pre-wrap; }
body.markdown pre code { background: none; padding: 0; }
body.markdown blockquote { border-left: 3px solid #d7d3d0; color: #57534e; padding-left: 1em; margin-left: 0; }
body.markdown table { border-collapse: collapse; }
body.markdown th, body.markdown td { border: 1px solid #e7e5e4; padding: 4px 10px; text-align: left; }
body.markdown hr { border: 0; border-top: 1px solid #e7e5e4; margin: 1.5em 0; }
body.markdown img { max-width: 100%; }
body.code { padding: 36px 40px; }
body.code pre { margin: 0; background: none !important; font: 15px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
`;

/**
 * The sheet a document is set on: white, in the system's own type, with a
 * policy that lets no script run and nothing but inline styles and inline
 * pictures load, since a Markdown file can carry any HTML at all.
 */
function sheet(kind: "code" | "markdown", body: string) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<style>${SHEET_STYLE}</style></head><body class="${kind}">${body}</body></html>`;
}

let sessionReady = false;

interface Drawer {
  busy: boolean;
  window: BrowserWindow;
}

/**
 * The session files are drawn in: nothing persists, nothing is granted, a
 * local page reaches its own folder and nothing else, and the network is the
 * page skill's hosts alone.
 */
function drawingSession() {
  const drawing = session.fromPartition("rendered-pictures");
  if (!sessionReady) {
    sessionReady = true;
    drawing.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });
    drawing.setPermissionCheckHandler(() => false);
    drawing.webRequest.onBeforeRequest((details, callback) => {
      const { hostname, protocol } = new URL(details.url);
      if (protocol === "file:") {
        callback({ cancel: !isAllowedLocalRequest(details) });
        return;
      }
      if (protocol === "data:" || protocol === "about:") {
        callback({});
        return;
      }
      callback({
        cancel: !(protocol === "https:" && PAGE_HOSTS.has(hostname)),
      });
    });
  }
  return drawing;
}

const drawers: Drawer[] = [];
const waiting: (() => void)[] = [];
let idleClose: ReturnType<typeof setTimeout> | undefined;

function closeAll() {
  idleClose = undefined;
  for (const { window } of drawers.splice(0)) {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
}

/** Who is waiting on each offscreen window's next frame. */
const frameWaiters = new WeakMap<
  BrowserWindow,
  ((image: NativeImage) => void)[]
>();

function makeWindow() {
  const window = new BrowserWindow({
    focusable: false,
    height: PAGE_VIEWPORT.height,
    show: false,
    skipTaskbar: true,
    useContentSize: true,
    webPreferences: {
      // A hidden window's timers are otherwise slowed, and the deferred
      // scripts a page draws with would not have run by the time it is
      // photographed.
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: OFFSCREEN,
      sandbox: true,
      session: drawingSession(),
      webSecurity: true,
    },
    width: PAGE_VIEWPORT.width,
  });
  const contents = window.webContents;
  contents.setAudioMuted(true);
  if (OFFSCREEN) {
    contents.on("paint", (_event, _dirty, image) => {
      for (const resolve of frameWaiters.get(window) ?? []) {
        resolve(image);
      }
      frameWaiters.delete(window);
    });
  }
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  // The file is put where it is by the load and goes nowhere of its own: a
  // redirecting page has nothing to show, and a page sending itself to
  // another file would be the file it names.
  contents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  // Light, whatever the app's theme, so a page that follows the reader's
  // draws on paper like the documents beside it.
  try {
    contents.debugger.attach("1.3");
    void contents.debugger
      .sendCommand("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: "light" }],
      })
      .catch(() => {
        // Drawn in the app's theme instead.
      });
  } catch {
    // Drawn in the app's theme instead.
  }
  window.on("closed", () => {
    const at = drawers.findIndex((entry) => entry.window === window);
    if (at !== -1) {
      drawers.splice(at, 1);
    }
  });
  return window;
}

/**
 * A frame an offscreen window paints from now on, with the page as it stands:
 * the view is marked for a repaint so one comes even when nothing on it moves.
 */
function nextFrame(window: BrowserWindow): Promise<NativeImage> {
  return new Promise((resolve) => {
    frameWaiters.set(window, [...(frameWaiters.get(window) ?? []), resolve]);
    window.webContents.invalidate();
  });
}

/** The page as the offscreen window paints it once its frames have caught up, skipping any empty one. */
async function offscreenFrame(window: BrowserWindow): Promise<NativeImage> {
  await sleep(OFFSCREEN_SETTLE_MS);
  let frame = await nextFrame(window);
  for (let tries = 0; frame.isEmpty() && tries < 3; tries++) {
    frame = await nextFrame(window);
  }
  return frame;
}

/** One of the drawing windows, made as they are needed, for as long as `work` takes. */
async function withWindow<T>(
  work: (window: BrowserWindow) => Promise<T>,
): Promise<T> {
  if (idleClose) {
    clearTimeout(idleClose);
    idleClose = undefined;
  }
  let drawer = drawers.find((entry) => !entry.busy);
  while (!drawer) {
    if (drawers.length < WINDOWS) {
      drawer = { busy: false, window: makeWindow() };
      drawers.push(drawer);
      break;
    }
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
    drawer = drawers.find((entry) => !entry.busy);
  }
  drawer.busy = true;
  const taken = drawer;
  try {
    return await work(taken.window);
  } catch (error) {
    log.warn(`Could not draw: ${String(error)}`);
    throw error;
  } finally {
    taken.busy = false;
    waiting.shift()?.();
    if (drawers.every((entry) => !entry.busy)) {
      idleClose = setTimeout(closeAll, IDLE_CLOSE_MS);
    }
  }
}
