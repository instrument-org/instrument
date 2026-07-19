import { app } from "electron";
import path from "node:path";

// Files under `resources/` are bundled by electron-builder and unpacked via
// `asarUnpack: ["resources/**"]`, so in a packaged app they live next to the
// asar rather than inside it. In dev the same tree sits in the package root.
// Mirrors getUvBinPath / getNodeModulePath in setup-bin-directory.ts.
export function getResourcePath(...parts: string[]): string {
  const appPath = app.getAppPath();
  const resourcePath = path.join(appPath, "resources", ...parts);

  if (app.isPackaged && appPath.endsWith(".asar")) {
    return resourcePath.replace(/app\.asar([/\\])/, "app.asar.unpacked$1");
  }

  return resourcePath;
}
