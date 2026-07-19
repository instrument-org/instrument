import { app } from "electron";
import path from "node:path";

// electron-builder unpacks `resources/**` and the native parts of
// `node_modules` via `asarUnpack`, so in a packaged app those trees live next
// to the asar rather than inside it. In dev both sit in the package root.
export function getAppUnpackedPath(...parts: string[]): string {
  const appPath = app.getAppPath();
  const fullPath = path.join(appPath, ...parts);

  if (app.isPackaged && appPath.endsWith(".asar")) {
    return fullPath.replace(/app\.asar([/\\])/, "app.asar.unpacked$1");
  }

  return fullPath;
}

export function getResourcePath(...parts: string[]): string {
  return getAppUnpackedPath("resources", ...parts);
}
