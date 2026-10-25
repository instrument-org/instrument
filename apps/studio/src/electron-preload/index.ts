import {
  CAPTURE_EXCEPTION_CHANNEL,
  CODE_EDITOR_FOCUS_CHANNEL,
  RESOLVE_THEME_CHANNEL,
  SETUP_STATE_CHANNEL,
  START_FILE_DRAG_CHANNEL,
} from "@/shared/constants";
import {
  BOOKMARKS_CHANNEL,
  type BookmarkOpBatch,
  type BookmarksSnapshot,
} from "@/shared/bookmarks";
import {
  isKeptFile,
  KEPT_STATE_CHANNEL,
  type KeptFile,
  type KeptSnapshot,
} from "@/shared/kept-state";
import {
  DRAFTS_CHANNEL,
  type DraftOpBatch,
  type DraftsSnapshot,
  type DraftStageRequest,
  type DraftTrashRequest,
} from "@/shared/drafts";
import { type SetupState } from "@/shared/setup";
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
 * the tabs it was left with rather than defaults it swaps out. A
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

/**
 * Where setup is as the window loads, read synchronously so a first launch
 * draws setup in its first render instead of the inbox it covers a moment
 * later. Null where the read fails, and the live state takes over.
 */
function loadSetupState(): null | SetupState {
  try {
    const value: unknown = ipcRenderer.sendSync(SETUP_STATE_CHANNEL);
    if (value !== null && typeof value === "object" && "step" in value) {
      // Main's own readSetupState, made for this window as it loads.
      return value as SetupState;
    }
  } catch {
    // Null, as below.
  }
  return null;
}

/**
 * The drafts as main has them, read synchronously for the same reason: a
 * chat's box reads the reply waiting in it as it first draws. A failed read
 * starts with none, and the window hears of them with the next change.
 */
function loadDrafts(): DraftsSnapshot {
  try {
    const value: unknown = ipcRenderer.sendSync(DRAFTS_CHANNEL.load);
    if (
      value !== null &&
      typeof value === "object" &&
      "drafts" in value &&
      Array.isArray(value.drafts) &&
      "acks" in value &&
      value.acks !== null &&
      typeof value.acks === "object"
    ) {
      // Main's own snapshot, made by the store this preload's window writes to.
      return value as DraftsSnapshot;
    }
  } catch {
    // Starts with none, as below.
  }
  return { acks: {}, drafts: [] };
}

/**
 * The bookmarks as main has them, read synchronously so the browser's
 * starting view draws them in its first render. A failed read starts with
 * none, and the window hears of them with the next change.
 */
function loadBookmarks(): BookmarksSnapshot {
  try {
    const value: unknown = ipcRenderer.sendSync(BOOKMARKS_CHANNEL.load);
    if (
      value !== null &&
      typeof value === "object" &&
      "bookmarks" in value &&
      Array.isArray(value.bookmarks) &&
      "acks" in value &&
      value.acks !== null &&
      typeof value.acks === "object"
    ) {
      // Main's own snapshot, made by the store this preload's window writes to.
      return value as BookmarksSnapshot;
    }
  } catch {
    // Starts with none, as below.
  }
  return { acks: {}, bookmarks: [] };
}

const api: Window["api"] = {
  bookmarks: {
    apply: async (batch: BookmarkOpBatch) => {
      await ipcRenderer.invoke(BOOKMARKS_CHANNEL.apply, batch);
    },
    initial: loadBookmarks(),
    onChange: (listener) => {
      const forward = (_event: unknown, snapshot: BookmarksSnapshot) => {
        listener(snapshot);
      };
      ipcRenderer.on(BOOKMARKS_CHANNEL.changed, forward);
      return () => {
        ipcRenderer.off(BOOKMARKS_CHANNEL.changed, forward);
      };
    },
  },
  captureException: async (payload) => {
    const answer: unknown = await ipcRenderer.invoke(
      CAPTURE_EXCEPTION_CHANNEL,
      payload,
    );
    return isCaptured(answer) ? answer : null;
  },
  // Sent, not invoked: the main process only keeps the latest word, and
  // reads it as each key press arrives.
  codeEditorFocus: (focused) => {
    ipcRenderer.send(CODE_EDITOR_FOCUS_CHANNEL, focused);
  },
  drafts: {
    apply: async (batch: DraftOpBatch) => {
      await ipcRenderer.invoke(DRAFTS_CHANNEL.apply, batch);
    },
    initial: loadDrafts(),
    onChange: (listener) => {
      const forward = (_event: unknown, snapshot: DraftsSnapshot) => {
        listener(snapshot);
      };
      ipcRenderer.on(DRAFTS_CHANNEL.changed, forward);
      return () => {
        ipcRenderer.off(DRAFTS_CHANNEL.changed, forward);
      };
    },
    stage: async (request: DraftStageRequest) => {
      const answer: unknown = await ipcRenderer.invoke(
        DRAFTS_CHANNEL.stage,
        request,
      );
      // Main's answer to the stage it was asked for.
      return answer as { path: string; size: number };
    },
    trash: async (request: DraftTrashRequest) => {
      await ipcRenderer.invoke(DRAFTS_CHANNEL.trash, request);
    },
  },
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  homeDir: os.homedir(),
  initialSetupState: loadSetupState(),
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

function isCaptured(
  value: unknown,
): value is { fingerprint: string; id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "fingerprint" in value &&
    "id" in value &&
    typeof value.fingerprint === "string" &&
    typeof value.id === "string"
  );
}

const windowType = process.argv
  .find((arg) => arg.startsWith("--windowType="))
  ?.split("=")[1] as Window["api"]["windowType"];

if (windowType) {
  api.windowType = windowType;
}

const systemRegion = process.argv
  .find((arg) => arg.startsWith("--systemRegion="))
  ?.split("=")[1];

if (systemRegion) {
  api.systemRegion = systemRegion;
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
  // says where a frame was loaded from, never who wrote what it runs.
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
