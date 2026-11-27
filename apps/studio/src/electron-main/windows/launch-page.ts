import { rendererBaseURL } from "@/electron-main/lib/renderer-host";
import { peekWindowKeptState } from "@/electron-main/stores/workspace/kept-state";
import { LAUNCH_PAGE_PATH } from "@/shared/constants";
import { CARD_INSETS_KEY, keptCardInsetsOf } from "@/shared/kept-state";
import { LAUNCH_SHAPE_HTML, launchShapeCss } from "@/shared/launch-shape";
import { type BrowserWindow } from "electron";

/**
 * Loads the window's shape (`launch-shape.ts`) into the launch's first
 * window, as a document of the renderer's origin (`LAUNCH_PAGE_PATH`): the
 * page that loads over it once boot adopts the window keeps its renderer.
 * Given as the address's own content rather than through the app scheme's
 * handler, which answers only once main's thread is free, and main is busy
 * loading.
 */
export function loadLaunchPage(
  window: BrowserWindow,
  { id, zoom }: { id: string; zoom: number },
) {
  const css = launchShapeCss({
    insets: keptCardInsetsOf(peekWindowKeptState(id, CARD_INSETS_KEY)),
    isMac: process.platform === "darwin",
    zoom,
  });
  const html = `<!doctype html><meta charset="utf-8"><style>html, body { margin: 0; }${css}</style>${LAUNCH_SHAPE_HTML}`;
  window.webContents
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, {
      baseURLForDataURL: new URL(
        LAUNCH_PAGE_PATH.slice(1),
        rendererBaseURL(),
      ).toString(),
    })
    // Superseded by the page itself, or a window boot let go of: either way
    // the page draws what this would have.
    .catch(() => {});
}
