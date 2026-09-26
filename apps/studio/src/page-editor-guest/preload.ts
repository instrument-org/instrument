/**
 * The preload of every browser guest. It does nothing unless the guest is
 * showing a page's file being edited in place, and on a site it does not even
 * ask: the question is one synchronous message to the main process, made
 * before the page's first script so the editor can watch the page build
 * itself (see `observer.js`).
 *
 * The editor runs here, in the preload's isolated world: it reads and
 * changes the page's DOM, and the page's scripts cannot see it, call it, or
 * reach the channel it talks to the window on.
 */
import { ipcRenderer, webFrame } from "electron";

import { installObserver } from "./port/observer.js";

const BOOT_CHANNEL = "page-editor:boot";
const CHANNEL = "page-editor";

/** The world this preload runs in, which Electron's context isolation keeps apart from the page's. */
const ISOLATED_WORLD = 999;

type Boot =
  | {
      bundle: string;
      name: string;
      src: string;
      state: unknown;
      version: string;
    }
  | { error: string };

function boot() {
  if (/^(?:https?|about|chrome|devtools):$/.test(location.protocol)) {
    return;
  }
  let answer: Boot | null = null;
  try {
    answer = ipcRenderer.sendSync(BOOT_CHANNEL) as Boot | null;
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
  const bridge = {
    boot: answer,
    listen: (handler: (message: unknown) => void) => {
      ipcRenderer.on(CHANNEL, (_event, message: unknown) => {
        handler(message);
      });
    },
    send,
  };
  Object.assign(globalThis, { __instrumentPageEditor: bridge });
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

/** A message to the window, on the channel the page's scripts cannot reach. */
function send(message: unknown) {
  ipcRenderer.sendToHost(CHANNEL, message);
}

boot();
