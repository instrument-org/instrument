import {
  frontMatterTitle,
  isMapping,
  splitFrontMatter,
} from "@/shared/front-matter";
import {
  BrowserWindow,
  type CallbackResponse,
  type NativeImage,
  type OnBeforeRequestListenerDetails,
  session,
} from "electron";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { sleep } from "radashi";
import { type BundledLanguage, bundledLanguages } from "shiki";
import { parse } from "yaml";

import { captureFrame } from "../browser-view/capture-frame";
import { guests } from "../browser-view/guest-registry";
import { confineLocalPagesToTheirFolder } from "../browser-view/local-file-policy";
import { createScopedLogger } from "./electron-logger";
import {
  extensionOf,
  type RenderedKind,
  renderedKindOf,
} from "./rendered-kinds";
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
 * Drawn in the app's theme: a page that follows the reader's draws dark in a
 * dark app, as it will when opened there, and a document is set on a sheet of
 * the theme's own colors. Each theme's picture is kept apart.
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
/** How long a theme change is waited on before the load goes ahead without its answer. */
const EMULATE_WAIT_MS = 300;
/** How much of a file a document is set from; a thumbnail shows its first page. */
const READ_BYTES = 48 * 1024;
const CODE_LINES = 90;
/** Past this many characters a line is minified or generated, and highlighting it is slow and shows nothing. */
const HIGHLIGHT_LINE_MAX = 2000;
/** The rows of a delimited file a thumbnail shows, header aside: more than a sheet holds. */
const TABLE_ROWS = 40;
/** The columns it shows; the rest are off the sheet's right edge anyway. */
const TABLE_COLUMNS = 12;
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
  theme: "dark" | "light",
): Promise<{ complete: boolean; image: NativeImage }> {
  const kind = renderedKindOf(hostPath);
  if (!kind) {
    throw new Error(`${hostPath} is not a kind drawn here`);
  }
  // Set inside a window's turn, so the highlighting, which holds the main
  // thread while it runs, happens two files at a time rather than for every
  // file a folder asks for at once.
  return withWindow(async (window) => {
    const document =
      kind === "page" ? undefined : await documentOf(hostPath, kind, theme);
    await emulateTheme(window, theme);
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
      if (OFFSCREEN) {
        await sleep(OFFSCREEN_SETTLE_MS);
      }
      const shot = await captureFrame(contents, {
        deadlineMs: CAPTURE_TIMEOUT_MS,
        rect: { height: viewport.height, width: viewport.width, x: 0, y: 0 },
        rejectEmpty: true,
      });
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
async function documentOf(
  hostPath: string,
  kind: Exclude<RenderedKind, "page">,
  theme: "dark" | "light",
) {
  const { cut, text } = await readHead(hostPath);
  if (kind === "markdown") {
    // Loaded with the first document, not with the app.
    const { marked } = await import("marked");
    const { body, fm } = splitFrontMatter(text);
    const html = await marked.parse(body, { async: true, gfm: true });
    return sheet("markdown", frontMatterPanel(fm) + html, theme);
  }
  if (kind === "table") {
    const { default: Papa } = await import("papaparse");
    const records = Papa.parse<string[]>(text, {
      // As the viewer reads it: the extension decides a `.tsv`, since Papa's
      // guess goes wrong on a first line holding more commas than tabs.
      delimiter: extensionOf(hostPath) === "tsv" ? "\t" : undefined,
      skipEmptyLines: "greedy",
    }).data.filter((record) => Array.isArray(record));
    // The read may have stopped partway through the last record.
    const complete = cut ? records.slice(0, -1) : records;
    return sheet("table", tableOf(complete), theme);
  }
  if (kind === "text") {
    const lines = text.split(/\r?\n/).slice(0, CODE_LINES).join("\n");
    return sheet("text", escapeHtml(lines), theme);
  }
  const extension = extensionOf(hostPath);
  const code = extension === "json" ? await prettyJson(hostPath, text) : text;
  // Whole lines, wrapped as the viewer wraps them: a line cut short can leave
  // a string open, and the grammar then reads the rest of the file as broken.
  const lines = code.split(/\r?\n/).slice(0, CODE_LINES).join("\n");
  const language = languageOf(extension);
  const unreadable = lines
    .split("\n")
    .some((line) => line.length > HIGHLIGHT_LINE_MAX);
  if (!language || unreadable) {
    return sheet("code", `<pre><code>${escapeHtml(lines)}</code></pre>`, theme);
  }
  const highlighter = await getHighlighter();
  if (!highlighter.getLoadedLanguages().includes(language)) {
    await highlighter.loadLanguage(bundledLanguages[language]);
  }
  return sheet(
    "code",
    highlighter.codeToHtml(lines, {
      lang: language,
      theme: theme === "dark" ? "github-dark-default" : "github-light-default",
    }),
    theme,
  );
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Front matter as the viewer first shows it: its panel folded to one line
 * naming the file and counting its properties. Left to `marked`, the closing
 * fence would underline the block into a heading. YAML that is not a mapping
 * is shown as the code it is, and an empty block shows nothing, as there.
 */
function frontMatterPanel(fm: string) {
  const source = fm.replace(/^---[^\n]*\n/, "").replace(/\n[^\n]*\n?$/, "");
  if (source.trim() === "") {
    return "";
  }
  let parsed: unknown;
  try {
    parsed = parse(source);
  } catch {
    parsed = source;
  }
  if (parsed === null || parsed === undefined) {
    return "";
  }
  if (!isMapping(parsed)) {
    return `<pre><code>${escapeHtml(source)}</code></pre>`;
  }
  const count = Object.keys(parsed).length;
  const title = frontMatterTitle(parsed) ?? "Properties";
  return `<div class="front-matter"><span class="caret"></span><span class="title">${escapeHtml(title)}</span><span class="count">${count === 1 ? "1 property" : `${count} properties`}</span></div>`;
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
    return {
      /** Whether the file goes on past what was read. */
      cut: bytesRead === READ_BYTES,
      text: buffer.subarray(0, bytesRead).toString("utf8"),
    };
  } finally {
    await handle.close();
  }
}

/**
 * A delimited file's first rows as the viewer's grid draws them: the first
 * record as the header, every row squared off to the widest, and a column
 * whose values all read as numbers set to the right.
 */
function tableOf(records: string[][]) {
  const [header = [], ...body] = records;
  const rows = body.slice(0, TABLE_ROWS);
  let width = 0;
  for (const record of [header, ...rows]) {
    width = Math.max(width, record.length);
  }
  width = Math.min(width, TABLE_COLUMNS);
  const columns = Array.from({ length: width }, (_, index) => {
    const values = rows.map((row) => row[index] ?? "").filter(Boolean);
    const numeric =
      values.length > 0 &&
      values.every((value) => !Number.isNaN(Number(value)));
    return numeric ? ' class="num"' : "";
  });
  const cells = (record: string[], tag: "td" | "th") =>
    columns
      .map(
        (align, index) =>
          `<${tag}${align}>${escapeHtml(record[index] ?? "")}</${tag}>`,
      )
      .join("");
  return `<table><thead><tr>${cells(header, "th")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${cells(row, "td")}</tr>`)
    .join("")}</tbody></table>`;
}

/** A sheet's colors in each theme, the app's own card and ink. */
const SHEET_COLORS = {
  dark: `:root { color-scheme: dark; --paper: #1f1d1b; --ink: #e7e5e4; --muted: #a8a29e; --rule: #3a3734; --well: #2a2826; --link: #5ccfbf; }`,
  light: `:root { color-scheme: light; --paper: #fff; --ink: #1c1917; --muted: #57534e; --rule: #e7e5e4; --well: #f5f5f4; --link: #0b6056; }`,
};

const SHEET_STYLE = `
html, body { margin: 0; background: var(--paper); color: var(--ink); }
body { overflow: hidden; -webkit-font-smoothing: antialiased; }
body.markdown { padding: 56px 64px; font: 17px/1.55 -apple-system, "Segoe UI", system-ui, sans-serif; }
body.markdown h1 { font-size: 2em; line-height: 1.2; margin: 0 0 0.5em; }
body.markdown h2 { font-size: 1.45em; line-height: 1.25; margin: 1.2em 0 0.4em; }
body.markdown h3 { font-size: 1.15em; margin: 1.1em 0 0.3em; }
body.markdown p, body.markdown ul, body.markdown ol, body.markdown blockquote, body.markdown table, body.markdown pre { margin: 0 0 0.9em; }
body.markdown ul, body.markdown ol { padding-left: 1.4em; }
body.markdown a { color: var(--link); }
body.markdown code { font: 0.88em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--well); border-radius: 4px; padding: 0.1em 0.3em; }
body.markdown pre { background: var(--well); border-radius: 8px; padding: 14px 16px; white-space: pre-wrap; }
body.markdown pre code { background: none; padding: 0; }
body.markdown blockquote { border-left: 3px solid var(--rule); color: var(--muted); padding-left: 1em; margin-left: 0; }
body.markdown table { border-collapse: collapse; }
body.markdown th, body.markdown td { border: 1px solid var(--rule); padding: 4px 10px; text-align: left; }
body.markdown hr { border: 0; border-top: 1px solid var(--rule); margin: 1.5em 0; }
body.markdown img { max-width: 100%; }
body.markdown .front-matter { display: flex; align-items: center; gap: 8px; margin: 0 0 1.2em; padding: 8px 12px; border: 1px solid var(--rule); border-radius: 8px; background: var(--well); font-size: 0.82em; }
body.markdown .front-matter .caret { flex: none; width: 0; height: 0; border-block: 4px solid transparent; border-left: 6px solid var(--muted); margin: 0 3px; }
body.markdown .front-matter .title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
body.markdown .front-matter .count { flex: none; color: var(--muted); font-size: 0.85em; }
body.text { padding: 56px 64px; font: 15px/1.625 -apple-system, "Segoe UI", system-ui, sans-serif; white-space: pre-wrap; overflow-wrap: break-word; }
body.code { padding: 36px 40px; }
body.table { font: 14px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif; }
body.table table { border-collapse: collapse; white-space: nowrap; }
body.table th, body.table td { max-width: 260px; overflow: hidden; text-overflow: ellipsis; padding: 7px 12px; border-bottom: 1px solid var(--rule); border-right: 1px solid var(--rule); text-align: left; }
body.table th { font-weight: 500; }
body.table .num { text-align: right; font-variant-numeric: tabular-nums; }
body.code pre { margin: 0; background: none !important; font: 15px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
`;

/**
 * The sheet a document is set on: the theme's paper, in the system's own
 * type, with a policy that lets no script run and nothing but inline styles
 * and inline pictures load, since a Markdown file can carry any HTML at all.
 */
function sheet(
  kind: Exclude<RenderedKind, "page">,
  body: string,
  theme: "dark" | "light",
) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<style>${SHEET_COLORS[theme]}${SHEET_STYLE}</style></head><body class="${kind}">${body}</body></html>`;
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
    guests.watchSession(drawing, () => "picture");
    confineLocalPagesToTheirFolder(drawing, pageHostsOnly);
  }
  return drawing;
}

/** What a drawn page may load besides its own folder's files: inline data and the page skill's hosts. */
function pageHostsOnly(
  details: OnBeforeRequestListenerDetails,
): CallbackResponse {
  const { hostname, protocol } = new URL(details.url);
  if (protocol === "data:" || protocol === "about:") {
    return {};
  }
  return { cancel: !(protocol === "https:" && PAGE_HOSTS.has(hostname)) };
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

/** The window's pages told the reader prefers `theme`, for the file drawn next. */
async function emulateTheme(window: BrowserWindow, theme: "dark" | "light") {
  const { debugger: link } = window.webContents;
  if (!link.isAttached()) {
    return;
  }
  // A window that has drawn nothing yet has no page to answer until the
  // load gives it one; the command is queued for that page all the same.
  await Promise.race([
    link
      .sendCommand("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: theme }],
      })
      .catch(() => {
        // Drawn in the system's theme instead.
      }),
    sleep(EMULATE_WAIT_MS),
  ]);
}

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
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  // The file is put where it is by the load and goes nowhere of its own: a
  // redirecting page has nothing to show, and a page sending itself to
  // another file would be the file it names.
  contents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  // How the theme a file is drawn in is told to its page.
  try {
    contents.debugger.attach("1.3");
  } catch {
    // Drawn in the system's theme instead.
  }
  window.on("closed", () => {
    const at = drawers.findIndex((entry) => entry.window === window);
    if (at !== -1) {
      drawers.splice(at, 1);
    }
  });
  return window;
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
