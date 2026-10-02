import {
  PAGE_EDITOR_BOOT_CHANNEL,
  PAGE_EDITOR_CHANNEL,
  PAGE_THUMB_CHANNEL,
} from "@/shared/page-editor-channels";
import { type PageEditorGuestMessage } from "@/shared/page-editor-messages";
/**
 * The preload of every browser guest. On every page it hands the mouse's
 * thumb buttons to the window. Otherwise it does nothing unless the guest is
 * showing a page's file being edited in place, and on a site it does not even
 * ask: the question is one synchronous message to the main process, made
 * before the page's first script so the editor can watch the page build
 * itself (see `editor/observer.ts`).
 *
 * The editor runs here, in the preload's isolated world: it reads and
 * changes the page's DOM, and the page's scripts cannot see it, call it, or
 * reach the channel it talks to the window on.
 */
import { ipcRenderer, webFrame } from "electron";

import { type PageEditorBoot, type PageEditorBridge } from "./bridge";
import { installObserver } from "./editor/observer";

/** The world this preload runs in, which Electron's context isolation keeps apart from the page's. */
const ISOLATED_WORLD = 999;

type Boot = PageEditorBoot | { error: string };

function boot() {
  if (/^(?:https?|about|chrome|devtools):$/.test(location.protocol)) {
    return;
  }
  let answer: Boot | null = null;
  try {
    answer = ipcRenderer.sendSync(PAGE_EDITOR_BOOT_CHANNEL) as Boot | null;
  } catch {
    return;
  }
  if (!answer) {
    return;
  }
  if ("error" in answer) {
    send({ kind: "error", message: answer.error, type: "status" });
    return;
  }
  const bridge: PageEditorBridge = {
    boot: answer,
    listen: (handler) => {
      // The window is the only sender on this channel: a guest's embedder.
      ipcRenderer.on(
        PAGE_EDITOR_CHANNEL,
        (_event, message: Parameters<typeof handler>[0]) => {
          handler(message);
        },
      );
    },
    send,
  };
  window.__instrumentPageEditor = bridge;
  // Now, before the page's first script, so every node the page's scripts
  // add or change is seen being added or changed.
  installObserver();
  // The bundle is an IIFE that reads the bridge above. It runs in this world,
  // never the page's, once there is a document for its libraries to look at,
  // and as a script the app injects rather than text turned into code, so a
  // page's own Content-Security-Policy has no say in it.
  const { bundle } = answer;
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      webFrame
        .executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: bundle }])
        .catch((error: unknown) => {
          send({
            kind: "error",
            message: `The editor could not start: ${error instanceof Error ? error.message : String(error)}`,
            type: "status",
          });
        });
    },
    { once: true },
  );
}

/**
 * On a Mac the thumb buttons reach a page as mouse events, and Chromium steps
 * the guest's own history on the release unless the page consumes it; the
 * window decides instead, since back from a page's first entry is the tab's
 * back. Taken on the way down, before the page's own listeners, and on every
 * phase of the press, so neither Chromium nor a handler under the pointer
 * acts on it. Elsewhere the buttons arrive through the main process.
 */
function handThumbsToWindow() {
  if (process.platform !== "darwin") {
    return;
  }
  window.addEventListener("mousedown", swallow, { capture: true });
  window.addEventListener("auxclick", swallow, { capture: true });
  window.addEventListener(
    "mouseup",
    (event) => {
      if (!isThumb(event)) {
        return;
      }
      swallow(event);
      ipcRenderer.sendToHost(
        PAGE_THUMB_CHANNEL,
        event.button === 3 ? "back" : "forward",
      );
    },
    { capture: true },
  );
}

/** Whether a press is one of the mouse's thumb buttons, back or forward. */
function isThumb(event: MouseEvent) {
  return event.button === 3 || event.button === 4;
}

/** A message to the window, on the channel the page's scripts cannot reach. */
function send(message: PageEditorGuestMessage) {
  ipcRenderer.sendToHost(PAGE_EDITOR_CHANNEL, message);
}

/** Keeps a thumb press from the page and from Chromium's own history step. */
function swallow(event: MouseEvent) {
  if (isThumb(event)) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}

handThumbsToWindow();
boot();
