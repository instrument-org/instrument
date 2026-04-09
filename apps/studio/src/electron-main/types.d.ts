import type { WebContents } from "electron";

// https://github.com/electron/electron/issues/50249: In Electron 41+, webContents is undefined after the
// view is destroyed, but the upstream type incorrectly declares it as always-defined.
declare module "electron" {
  interface WebContentsView {
    readonly webContents: undefined | WebContents;
  }
}
