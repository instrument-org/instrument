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
import { ipcRenderer } from "electron";

import { installObserver } from "./port/observer.js";

const BOOT_CHANNEL = "page-editor:boot";
const CHANNEL = "page-editor";

interface Boot {
  bundle: string;
  name: string;
  src: string;
  state: unknown;
  version: string;
}

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
  const bridge = {
    boot: answer,
    listen: (handler: (message: unknown) => void) => {
      ipcRenderer.on(CHANNEL, (_event, message: unknown) => {
        handler(message);
      });
    },
    send: (message: unknown) => {
      ipcRenderer.sendToHost(CHANNEL, message);
    },
  };
  Object.assign(globalThis, { __instrumentPageEditor: bridge });
  // Now, before the page's first script, so every node the page's scripts
  // add or change is seen being added or changed.
  installObserver();
  // The bundle is an IIFE that reads the bridge above; evaluated in this
  // world, never the page's, once there is a document for its libraries to
  // look at.
  const { bundle } = answer;
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      // The one place text becomes code, and the text is the app's own
      // bundle from the main process, never the page's.
      // oxlint-disable-next-line typescript/no-implied-eval
      Reflect.apply(new Function(bundle), globalThis, []);
    },
    { once: true },
  );
}

boot();
