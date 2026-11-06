import { BrowserWindow, systemPreferences } from "electron";

import { type Bounds, type Point } from "./tab-carry-rules";

/** How wide the picture is drawn on the pointer. */
const PICTURE_WIDTH = 320;
/** How wide it is kept, to stay sharp as it grows into the window. */
const IMAGE_WIDTH = 1280;
/** How long it takes to grow into the window it stands for, and how often it moves. */
const GROW_MS = 160;
const GROW_STEP_MS = 8;
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
#picture{border-radius:10px;box-shadow:0 0 0 .5px rgb(0 0 0/.25),0 8px 20px rgb(0 0 0/.3);display:block;height:calc(100% - ${SHADOW_ROOM * 2}px);margin:${SHADOW_ROOM}px;object-fit:cover;object-position:top;opacity:0;transform:scale(.7);transition:opacity 120ms ease-out,transform 120ms ease-out;width:calc(100% - ${SHADOW_ROOM * 2}px)}
#picture.up{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){#picture{transition:none}}
</style></head><body><img alt="" id="picture"></body></html>`;

export interface TabPicture {
  close: () => void;
  /** Grows from the pointer to fill where the window it stands for is coming up. */
  growTo: (bounds: Bounds) => Promise<void>;
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
    enableLargerThanScreen: true,
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
    growTo: (bounds) =>
      new Promise((resolve) => {
        if (
          !isShown ||
          systemPreferences.getAnimationSettings().prefersReducedMotion
        ) {
          resolve();
          return;
        }
        const start = window.getBounds();
        const end = {
          height: bounds.height + SHADOW_ROOM * 2,
          width: bounds.width + SHADOW_ROOM * 2,
          x: bounds.x - SHADOW_ROOM,
          y: bounds.y - SHADOW_ROOM,
        };
        const startedAt = Date.now();
        const step = () => {
          if (window.isDestroyed()) {
            resolve();
            return;
          }
          const done = Math.min(1, (Date.now() - startedAt) / GROW_MS);
          const eased = 1 - (1 - done) ** 3;
          const at = (from: number, to: number) =>
            Math.round(from + (to - from) * eased);
          window.setBounds({
            height: at(start.height, end.height),
            width: at(start.width, end.width),
            x: at(start.x, end.x),
            y: at(start.y, end.y),
          });
          if (done < 1) {
            setTimeout(step, GROW_STEP_MS);
          } else {
            resolve();
          }
        };
        step();
      }),
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
    .resize({ quality: "good", width: IMAGE_WIDTH })
    .toJPEG(82);
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}
