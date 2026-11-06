import { BrowserWindow } from "electron";

import { type Point } from "./tab-carry-rules";

/** How wide the picture is drawn, at twice that for a sharp screen. */
const PICTURE_WIDTH = 320;
/** The room around the picture for its shadow. */
const SHADOW_ROOM = 24;
/**
 * The picture stands centered on the pointer. On Linux it hangs just clear of the
 * point of the pointer: a window of ours under the pointer takes the press's
 * release from the window that took the press, even one that takes no mouse events.
 */
const BELOW_POINTER_PX = 1;

const PAGE = `<!doctype html><html><head><style>
html,body{background:transparent;height:100%;margin:0;overflow:hidden}
#picture{border-radius:10px;box-shadow:0 0 0 .5px rgb(0 0 0/.25),0 8px 20px rgb(0 0 0/.3);display:block;margin:${SHADOW_ROOM}px;opacity:0;transform:scale(.7);transition:opacity 120ms ease-out,transform 120ms ease-out;width:${PICTURE_WIDTH}px}
#picture.up{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){#picture{transition:none}}
</style></head><body><img alt="" id="picture"></body></html>`;

export interface TabPicture {
  close: () => void;
  hide: () => void;
  moveTo: (point: Point) => void;
  show: (point: Point) => void;
}

/**
 * A small picture of the window as it stands, which goes with the pointer once the
 * tab is off its row. Nothing of the tab is in it: the tab stays in its window until
 * it is let go. A window of its own, for the length of one drag, that takes neither
 * focus nor the pointer.
 */
export function openTabPicture(from: BrowserWindow): TabPicture {
  const { height: fromHeight, width: fromWidth } = from.getContentBounds();
  const width = PICTURE_WIDTH + SHADOW_ROOM * 2;
  const height =
    Math.round((PICTURE_WIDTH * fromHeight) / fromWidth) + SHADOW_ROOM * 2;
  const window = new BrowserWindow({
    alwaysOnTop: true,
    focusable: false,
    frame: false,
    hasShadow: false,
    height,
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
    width,
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
  const loaded = window
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`)
    .catch(() => undefined);
  void pictureOf(from).then((image) =>
    image
      ? loaded.then(() =>
          say(
            `document.getElementById("picture").src = ${JSON.stringify(image)};`,
          ),
        )
      : undefined,
  );

  let isShown = false;
  const moveTo = ({ x, y }: Point) => {
    if (!window.isDestroyed()) {
      window.setPosition(
        Math.round(x - width / 2),
        Math.round(
          process.platform === "linux" ? y + BELOW_POINTER_PX : y - height / 2,
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
        void say(`document.getElementById("picture").classList.remove("up");`);
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
            `requestAnimationFrame(() => document.getElementById("picture").classList.add("up"));`,
          );
        }
      });
    },
  };
}

/** The window as it stands, as an address an image can load. */
async function pictureOf(from: BrowserWindow) {
  if (from.isDestroyed()) {
    return null;
  }
  const image = await from.webContents.capturePage().catch(() => null);
  if (!image || image.isEmpty()) {
    return null;
  }
  const jpeg = image
    .resize({ quality: "good", width: PICTURE_WIDTH * 2 })
    .toJPEG(82);
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}
