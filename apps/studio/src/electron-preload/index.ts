import { electronAPI } from "@electron-toolkit/preload";
import { contextBridge, ipcRenderer, webUtils } from "electron";

const api: Window["api"] = {
  getFilePath: (file: File) => webUtils.getPathForFile(file),
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
