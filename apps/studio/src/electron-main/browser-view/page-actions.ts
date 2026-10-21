import { getCallingWindow } from "@/electron-main/windows/calling-window";
import { dialog, ShareMenu, webContents, type WebContents } from "electron";

import { log } from "./log";
import { SAVE_FORMATS, saveName, saveTypeOf } from "./save-page-format";

/**
 * A browser guest by its contents id. Only a `<webview>` guest is saved; any
 * other contents is refused, so a window cannot be saved through this.
 */
function guestOf(webContentsId: number): null | WebContents {
  const guest = webContents.fromId(webContentsId);
  return guest && !guest.isDestroyed() && guest.getType() === "webview"
    ? guest
    : null;
}

/**
 * The page's address in the system's share menu, where the pointer is.
 * macOS only: the menu is AppKit's, and elsewhere the answer is false.
 */
export function sharePage({
  callerId,
  url,
}: {
  callerId: number;
  url: string;
}): boolean {
  if (process.platform !== "darwin") {
    return false;
  }
  const window = getCallingWindow(callerId);
  new ShareMenu({ urls: [url] }).popup(window ? { window } : {});
  return true;
}

/** Asks where to save the page, and in which format, and saves it there. */
export async function savePageAs({
  callerId,
  webContentsId,
}: {
  callerId: number;
  webContentsId: number;
}) {
  const guest = guestOf(webContentsId);
  if (!guest) {
    return;
  }
  const parent = getCallingWindow(callerId);
  const options = {
    defaultPath: saveName({ title: guest.getTitle(), url: guest.getURL() }),
    filters: SAVE_FORMATS.map(({ extension, name }) => ({
      extensions: [extension],
      name,
    })),
  };
  const { canceled, filePath } = await (parent
    ? dialog.showSaveDialog(parent, options)
    : dialog.showSaveDialog(options));
  if (canceled || !filePath || guest.isDestroyed()) {
    return;
  }
  try {
    await guest.savePage(filePath, saveTypeOf(filePath));
  } catch (error) {
    log.warn(`savePage failed error=${String(error)}`);
  }
}
