import { type AgentBrowserCommand } from "@/shared/agent-browser";
import { type TabCommand } from "@/shared/tabs";
import { electronAPI } from "@electron-toolkit/preload";
import { contextBridge, ipcRenderer, webUtils } from "electron";

const api: Window["api"] = {
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  onAgentBrowserCommand: (callback: (command: AgentBrowserCommand) => void) => {
    const listener = (_event: unknown, command: AgentBrowserCommand) => {
      callback(command);
    };
    ipcRenderer.on("agent-browser-command", listener);
    return () => {
      ipcRenderer.removeListener("agent-browser-command", listener);
    };
  },
  onNavigate: (callback: (url: string) => void) =>
    ipcRenderer.on("navigate", (_event, value: string) => {
      callback(value);
    }),
  onStudioOverlayNavigate: (
    callback: (location: string, seq: number) => void,
  ) =>
    ipcRenderer.on(
      "studio-overlay:navigate",
      (_event, location: string, seq: number) => {
        callback(location, seq);
      },
    ),
  onTabCommand: (callback: (command: TabCommand) => void) => {
    const listener = (_event: unknown, command: TabCommand) => {
      callback(command);
    };
    ipcRenderer.on("tab-command", listener);
    return () => {
      ipcRenderer.removeListener("tab-command", listener);
    };
  },
  studioOverlayRouteReady: (location: string, seq: number) => {
    ipcRenderer.send("studio-overlay:route-ready", location, seq);
  },
};

const tabId = process.argv
  .find((arg) => arg.startsWith("--tabId="))
  ?.split("=")[1];

if (tabId) {
  api.tabId = tabId;
}

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
    // eslint-disable-next-line no-console
    console.error("Failed to expose Electron APIs to renderer", error);
  }
} else {
  window.electron = electronAPI;
  window.api = api;
}

window.addEventListener("message", (event) => {
  if (event.data === "start-orpc-client") {
    const [serverPort] = event.ports;

    if (!serverPort) {
      // eslint-disable-next-line no-console
      console.error("No server port found for ORPC client");
      return;
    }

    ipcRenderer.postMessage("start-orpc-server", null, [serverPort]);
  }
});
