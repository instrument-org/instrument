import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { type TabPicturePaintOut } from "@/shared/tabs";
import { BrowserWindow } from "electron";

import { getAppZoom } from "@/electron-main/stores/workspace/window-state";

import { type Point } from "./tab-carry-rules";

/** The window around the picture, with room for its shadow. */
const WIDTH = 264;
const HEIGHT = 216;
/** How the picture of the page is drawn, at twice that for a sharp screen. */
const IMAGE_WIDTH = 240;
const IMAGE_HEIGHT = 150;
/** The picture stands centered on the pointer. */
const ABOVE_POINTER_PX = 96;
/**
 * On Linux it hangs just clear of the point of the pointer: a window of ours under
 * the pointer takes the press's release from the window that took the press, even
 * one that takes no mouse events.
 */
const BELOW_POINTER_PX = 1;
/** How far past what is painted out the paint goes, for its shadow and the picture's softness. */
const PAINT_OUT_MARGIN_PX = 5;

const PAGE = `<!doctype html><html><head><style>
:root{color-scheme:light dark}
html,body{background:transparent;height:100%;margin:0;overflow:hidden}
#card{background:Canvas;border-radius:12px;box-shadow:0 0 0 .5px rgb(0 0 0/.25),0 8px 20px rgb(0 0 0/.3);color:CanvasText;font:500 12px system-ui,-apple-system,sans-serif;left:12px;opacity:0;overflow:hidden;position:absolute;right:12px;top:6px;transform:scale(.7);transition:opacity 120ms ease-out,transform 120ms ease-out}
#card.up{opacity:1;transform:none}
#title{overflow:hidden;padding:7px 10px;text-overflow:ellipsis;white-space:nowrap}
#shot{height:${IMAGE_HEIGHT}px;overflow:hidden;position:relative}
#shot,#shot i{background:inherit}
#shot i{position:absolute}
#image{display:block;height:100%;object-fit:cover;object-position:top;width:100%}
@media (prefers-reduced-motion:reduce){#card{transition:none}}
</style></head><body><div id="card"><div id="title"></div><div id="shot"><img alt="" id="image"></div></div></body></html>`;

export interface TabPicture {
  close: () => void;
  hide: () => void;
  moveTo: (point: Point) => void;
  show: (point: Point) => void;
}

/**
 * A small picture of a tab, which goes with the pointer once the tab is off its
 * row. Nothing of the tab is in it: the tab stays in its window until it is let go.
 * A window of its own, for the length of one drag, that takes neither focus nor
 * the pointer. It shows only what goes with the tab, so what stands over the page
 * and stays with the window is painted out.
 */
export function openTabPicture(
  from: BrowserWindow,
  paintOut: TabPicturePaintOut,
): TabPicture {
  const window = new BrowserWindow({
    alwaysOnTop: true,
    focusable: false,
    frame: false,
    hasShadow: false,
    height: HEIGHT,
    resizable: false,
    show: false,
    skipTaskbar: true,
    transparent: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    width: WIDTH,
  });
  window.setIgnoreMouseEvents(true);
  if (process.platform === "darwin") {
    window.setVisibleOnAllWorkspaces(true, {
      skipTransformProcessType: true,
      visibleOnFullScreen: true,
    });
  }
  const say = (script: string) =>
    window.isDestroyed()
      ? Promise.resolve()
      : window.webContents.executeJavaScript(script).catch(() => undefined);
  // Read now: the window comes to be called what is up in it, which off the row is
  // the tab beside this one.
  const title = from.getTitle();
  const loaded = window
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`)
    .catch(() => undefined);
  void loaded.then(() =>
    say(
      `document.getElementById("title").textContent = ${JSON.stringify(title)};`,
    ),
  );
  void capturePage(from, paintOut).then((shot) =>
    shot
      ? loaded.then(() =>
          say(
            `document.getElementById("card").style.background = ${JSON.stringify(paintOut.ground)};
             document.getElementById("image").src = ${JSON.stringify(shot.image)};
             document.getElementById("shot").insertAdjacentHTML("beforeend", ${JSON.stringify(shot.paintedOut)});`,
          ),
        )
      : undefined,
  );

  let isShown = false;
  const moveTo = ({ x, y }: Point) => {
    if (!window.isDestroyed()) {
      window.setPosition(
        Math.round(x - WIDTH / 2),
        Math.round(
          process.platform === "linux"
            ? y + BELOW_POINTER_PX
            : y - ABOVE_POINTER_PX,
        ),
      );
    }
  };
  return {
    close: () => {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    },
    hide: () => {
      isShown = false;
      if (!window.isDestroyed()) {
        window.hide();
        void say(`document.getElementById("card").classList.remove("up");`);
      }
    },
    moveTo,
    show: (point) => {
      isShown = true;
      moveTo(point);
      void loaded.then(() => {
        if (isShown && !window.isDestroyed()) {
          window.showInactive();
          void say(
            `requestAnimationFrame(() => document.getElementById("card").classList.add("up"));`,
          );
        }
      });
    },
  };
}

/**
 * What the tab shows, under the window's bar, as an address an image can load, and
 * the marks that paint out what is not the tab's, placed as the image is drawn.
 */
async function capturePage(from: BrowserWindow, { over }: TabPicturePaintOut) {
  if (from.isDestroyed()) {
    return null;
  }
  const { height: windowHeight, width } = from.getContentBounds();
  const bar = Math.round(TOOLBAR_HEIGHT * getAppZoom());
  const height = windowHeight - bar;
  const image = await from.webContents
    .capturePage({ height, width, x: 0, y: bar })
    .catch(() => null);
  if (!image || image.isEmpty()) {
    return null;
  }
  const jpeg = image
    .resize({ quality: "good", width: IMAGE_WIDTH * 2 })
    .toJPEG(82);
  const scale = Math.max(IMAGE_WIDTH / width, IMAGE_HEIGHT / height);
  const left = (IMAGE_WIDTH - width * scale) / 2;
  return {
    image: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
    paintedOut: over
      .map(
        (rect) =>
          `<i style="height:${rect.height * scale + PAINT_OUT_MARGIN_PX * 2}px;left:${left + rect.x * scale - PAINT_OUT_MARGIN_PX}px;top:${(rect.y - bar) * scale - PAINT_OUT_MARGIN_PX}px;width:${rect.width * scale + PAINT_OUT_MARGIN_PX * 2}px"></i>`,
      )
      .join(""),
  };
}
