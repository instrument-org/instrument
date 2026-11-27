import { APP_NAME } from "@instrument-org/shared";
import { BrowserWindow, nativeTheme, screen } from "electron";

import { isHeldOffScreen } from "./on-screen";

/**
 * A small card of steps that floats over every other app, for a step the
 * person takes outside Instrument (approving it in another app, turning on a
 * permission in the system's settings), so the steps stay in sight while
 * that app is in front. It never takes the focus from that app, and stands
 * at the top right of the screen the app window is on.
 *
 * A page of its own with no script, as the workspace refusal window is: each
 * button a link read here rather than followed, each view drawn anew.
 */

/** The links the card's buttons are, read here rather than followed. */
const ACTION_SCHEME = "steps:";
const WIDTH = 320;
/** Its distance from the edges of the screen's usable area. */
const MARGIN = 16;

export type StepsView =
  | {
      /** Under the steps: what happens next, in a line. */
      foot?: string;
      steps: string[];
      title: string;
    }
  | {
      button: { action: string; label: string };
      done: string;
      title: string;
    };

export interface StepsWindow {
  close: () => void;
  isClosed: () => boolean;
  show: (view: StepsView) => void;
}

const open = new Map<string, StepsWindow>();
const windows = new Set<BrowserWindow>();

/** Whether a window is a steps card, which is never the window a person is left with. */
export function isStepsWindow(window: BrowserWindow): boolean {
  return windows.has(window);
}

/**
 * Puts up the card for `key` showing `view`, from the app window `opener`,
 * or shows `view` on the one already up. `onAction` hears every button but the card's own close;
 * `onClosed` hears it go, however it went. Null where no card is put up: an
 * app window held off screen, which an agent drives and the person at the
 * computer did not ask for.
 */
export function openStepsWindow(
  key: string,
  view: StepsView,
  {
    onAction,
    onClosed,
    opener,
  }: {
    onAction?: (action: string) => void;
    onClosed?: () => void;
    opener: BrowserWindow | null;
  },
): null | StepsWindow {
  const existing = open.get(key);
  if (existing && !existing.isClosed()) {
    existing.show(view);
    return existing;
  }
  if (!opener || isHeldOffScreen(opener)) {
    return null;
  }
  const isMac = process.platform === "darwin";
  const window = new BrowserWindow({
    acceptFirstMouse: true,
    alwaysOnTop: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#fbfaf8",
    // Off the Mac a window that can't be focused still takes clicks, and the
    // app in front keeps the keyboard.
    focusable: isMac,
    frame: false,
    fullscreenable: false,
    height: 200,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    title: APP_NAME,
    // On the Mac a panel takes a click without making Instrument the app in
    // front.
    ...(isMac ? { type: "panel" } : {}),
    webPreferences: { partition: "steps-window", sandbox: true },
    width: WIDTH,
  });
  windows.add(window);
  // Over a full-screen app's window too, and above the sheets and pickers
  // another app puts up.
  window.setAlwaysOnTop(true, "floating");
  if (isMac) {
    window.setVisibleOnAllWorkspaces(true, {
      skipTransformProcessType: true,
      visibleOnFullScreen: true,
    });
  }
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    if (!url.startsWith(ACTION_SCHEME)) {
      return;
    }
    const action = url.slice(ACTION_SCHEME.length);
    if (action === "close") {
      close();
    } else {
      onAction?.(action);
    }
  });

  const close = () => {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  };
  // The card belongs to the window it was put up from, and goes with it, so
  // it never keeps the app running with no window of its own.
  opener.once("closed", close);
  window.once("closed", () => {
    windows.delete(window);
    if (open.get(key) === handle) {
      open.delete(key);
    }
    if (!opener.isDestroyed()) {
      opener.off("closed", close);
    }
    onClosed?.();
  });

  // Each view loads after the one before it, so a quick second one never
  // lands under the first.
  let shown = Promise.resolve();
  const show = (next: StepsView) => {
    shown = shown.then(async () => {
      if (window.isDestroyed()) {
        return;
      }
      await window
        .loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(page(next))}`,
        )
        .catch(() => undefined);
      if (window.isDestroyed()) {
        return;
      }
      // The page's own height: the document's is never less than the window.
      const height: unknown = await window.webContents
        .executeJavaScript(
          'document.querySelector("main").getBoundingClientRect().height',
        )
        .catch(() => null);
      if (window.isDestroyed()) {
        return;
      }
      const contentHeight =
        typeof height === "number" ? Math.ceil(height) : 200;
      if (!window.isVisible()) {
        const { workArea } = screen.getDisplayMatching(opener.getBounds());
        window.setBounds({
          height: contentHeight,
          width: WIDTH,
          x: workArea.x + workArea.width - WIDTH - MARGIN,
          y: workArea.y + MARGIN,
        });
        window.showInactive();
      } else {
        window.setContentSize(WIDTH, contentHeight);
      }
    });
  };

  const handle: StepsWindow = {
    close,
    isClosed: () => window.isDestroyed(),
    show,
  };
  open.set(key, handle);
  show(view);
  return handle;
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** One view of the card, as a page with no script and nothing loaded from outside. */
function page(view: StepsView) {
  const body =
    "steps" in view
      ? `<ol>${view.steps.map((step, index) => `<li><span class="number">${index + 1}</span><span>${escapeHtml(step)}</span></li>`).join("")}</ol>
${view.foot ? `<p class="foot">${escapeHtml(view.foot)}</p>` : ""}`
      : `<div class="done"><span class="check">✓</span><p>${escapeHtml(view.done)}</p>
<a class="button" href="${ACTION_SCHEME}${encodeURIComponent(view.button.action)}">${escapeHtml(view.button.label)}</a></div>`;
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(view.title)}</title>
<style>
:root { color-scheme: light dark; --bg: #fbfaf8; --fg: #1d1d1f; --muted: #6e6e73; --rule: rgb(0 0 0 / .08); --chip: rgb(0 0 0 / .07); --primary: #1d1d1f; --primary-fg: #fff; }
@media (prefers-color-scheme: dark) { :root { --bg: #1c1c1e; --fg: #f5f5f7; --muted: #a1a1a6; --rule: rgb(255 255 255 / .1); --chip: rgb(255 255 255 / .1); --primary: #f5f5f7; --primary-fg: #1c1c1e; } }
html, body { margin: 0; background: var(--bg); color: var(--fg); font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; -webkit-user-select: none; user-select: none; cursor: default; }
main { display: flex; flex-direction: column; }
header { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--rule); font-weight: 600; -webkit-app-region: drag; }
header span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
header a { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 6px; color: var(--muted); text-decoration: none; font-size: 16px; line-height: 1; -webkit-app-region: no-drag; cursor: default; }
header a:hover { background: var(--chip); color: var(--fg); }
ol { list-style: none; margin: 0; padding: 14px 14px 0; display: flex; flex-direction: column; gap: 8px; }
li { display: flex; gap: 10px; }
.number { display: grid; place-items: center; flex: none; width: 20px; height: 20px; margin-top: -1px; border-radius: 50%; background: var(--chip); font-size: 11px; font-weight: 500; }
.foot { margin: 12px 14px 0; color: var(--muted); font-size: 12px; }
.body { padding-bottom: 14px; }
.done { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 18px 14px 0; text-align: center; }
.done p { margin: 0; font-weight: 500; }
.check { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--chip); font-size: 16px; }
a.button { margin-top: 4px; padding: 4px 12px; border-radius: 6px; background: var(--primary); color: var(--primary-fg); font-size: 12px; font-weight: 500; text-decoration: none; cursor: default; -webkit-app-region: no-drag; }
</style></head>
<body><main>
<header><span>${escapeHtml(view.title)}</span><a href="${ACTION_SCHEME}close" aria-label="Close">×</a></header>
<div class="body">${body}</div>
</main></body></html>`;
}
