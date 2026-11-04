const idsByContents = new Map<number, string>();

/**
 * The id an app window keeps its state under, by its web contents. Apart from
 * the windows themselves, since the kept state answers a window's preload
 * while it loads and is read by what builds the windows.
 */
export function appWindowIdOf(webContentsId: number): string | undefined {
  return idsByContents.get(webContentsId);
}

export function nameAppWindow(webContentsId: number, windowId: string) {
  idsByContents.set(webContentsId, windowId);
}

export function forgetAppWindowName(webContentsId: number) {
  idsByContents.delete(webContentsId);
}
