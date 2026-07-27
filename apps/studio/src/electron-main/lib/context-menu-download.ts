import { type BrowserWindow } from "electron";
import { CancelError, download } from "electron-dl";

import { captureServerException } from "./capture-server-exception";

export async function saveContextMenuMediaAs({
  browserWindow,
  url,
}: {
  browserWindow: BrowserWindow;
  url: string;
}) {
  try {
    await download(browserWindow, url, { saveAs: true });
  } catch (error) {
    if (error instanceof CancelError) {
      return;
    }
    captureServerException(error);
  }
}
