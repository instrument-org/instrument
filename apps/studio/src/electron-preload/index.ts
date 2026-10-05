import {
  RESOLVE_THEME_CHANNEL,
  START_FILE_DRAG_CHANNEL,
} from "@/shared/constants";
import {
  isKeptFile,
  KEPT_STATE_CHANNEL,
  type KeptFile,
  type KeptSnapshot,
} from "@/shared/kept-state";
import { electronAPI } from "@electron-toolkit/preload";
import { contextBridge, ipcRenderer, webUtils } from "electron";
import os from "node:os";

/**
 * Put the theme class on <html> before the document is parsed.
 *
 * The app's stylesheet is render-blocking and paints `body { background:
 * var(--background) }` the moment it loads, which resolves light until that
 * class lands. Nothing in the renderer can beat it: every script, deferred or
 * not, waits for pending stylesheets, and the bundle still has to compile after
 * that. So a dark-mode launch flashes white. The preload runs earlier than any
 * of it and can ask the main process, which owns the preference.
 */
function applyInitialTheme() {
  let theme: unknown;
  try {
    theme = ipcRenderer.sendSync(RESOLVE_THEME_CHANNEL);
  } catch {
    // Leave the class to ThemeProvider rather than guessing wrong.
    return;
  }

  if (theme !== "dark" && theme !== "light") {
    return;
  }

  // <html> usually doesn't exist yet at document-start (querySelector rather
  // than documentElement, which is typed as though it always does), so fall
  // back to waiting for the parser to create it.
  const apply = () => {
    const root = document.querySelector("html");
    root?.classList.add(theme);
    return Boolean(root);
  };

  if (apply()) {
    return;
  }

  const observer = new MutationObserver(() => {
    if (apply()) {
      observer.disconnect();
    }
  });
  observer.observe(document, { childList: true });
}

applyInitialTheme();

/**
 * Everything the windows keep, read synchronously so the first render has
 * the tabs and drafts it was left with rather than defaults it swaps out. A
 * failed read starts from the defaults, and the window's writes still land.
 */
function loadKeptState(): KeptSnapshot {
  let value: unknown;
  try {
    value = ipcRenderer.sendSync(KEPT_STATE_CHANNEL.load);
  } catch {
    return {};
  }
  if (value === null || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([file, keys]: [string, unknown]) =>
      isKeptFile(file) && keys !== null && typeof keys === "object"
        ? [[file, Object.fromEntries(Object.entries(keys))]]
        : [],
    ),
  );
}

const api: Window["api"] = {
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  homeDir: os.homedir(),
  keptState: {
    initial: loadKeptState(),
    onChange: (listener) => {
      const forward = (
        _event: unknown,
        file: KeptFile,
        key: string,
        value: unknown,
      ) => {
        listener(file, key, value);
      };
      ipcRenderer.on(KEPT_STATE_CHANNEL.changed, forward);
      return () => {
        ipcRenderer.off(KEPT_STATE_CHANNEL.changed, forward);
      };
    },
    set: (file, key, value) => {
      ipcRenderer.send(KEPT_STATE_CHANNEL.set, file, key, value);
    },
  },
  // One-way bridge for forwarding renderer errors to the main-process dev log.
  // The main side only listens in development, so this is a no-op in production.
  rendererLog: (entry) => {
    ipcRenderer.send("renderer-log", entry);
  },
  // Sent, not invoked: the main process has to hand the drag to the OS while
  // the pointer is still down, and awaiting a reply here would put the round
  // trip inside the gesture. The drag image was rendered ahead of it (see
  // electron-main/lib/file-drag), so this carries only the paths.
  startFileDrag: (files) => {
    ipcRenderer.send(START_FILE_DRAG_CHANNEL, { files });
  },
};

const windowType = process.argv
  .find((arg) => arg.startsWith("--windowType="))
  ?.split("=")[1] as Window["api"]["windowType"];

if (windowType) {
  api.windowType = windowType;
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error("Failed to expose Electron APIs to renderer", error);
  }
} else {
  window.electron = electronAPI;
  window.api = api;
}

window.addEventListener("message", (event) => {
  // Only the renderer's own main world may hand over an RPC port. A child frame
  // calling `parent.postMessage` raises the same event on this window, and the
  // file viewer previews task HTML in an iframe that runs scripts -- without
  // this check that content could pass its own port and drive the entire oRPC
  // router (file I/O, shell, workspace) from inside the sandbox. `event.origin`
  // cannot tell them apart: the packaged app loads over `file://`, which
  // serializes to "null", exactly like a sandboxed frame's opaque origin.
  if (event.source !== window) {
    return;
  }

  if (event.data === "start-orpc-client") {
    const [serverPort] = event.ports;

    if (!serverPort) {
      console.error("No server port found for ORPC client");
      return;
    }

    ipcRenderer.postMessage("start-orpc-server", null, [serverPort]);
  }
});
