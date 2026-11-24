import { BrowserWindow, nativeTheme, session } from "electron";

import { type Theme } from "./site-icons";

/** How long one icon has to load and be measured. */
const MEASURE_TIMEOUT_MS = 5000;
/** How long the measuring window stays open for the next icon. */
const IDLE_CLOSE_MS = 10_000;

/** The surfaces an icon is measured on: a card in each theme (`--card` in globals.css). */
const GROUNDS: Record<Theme, [number, number, number]> = {
  dark: [41, 37, 36],
  light: [255, 255, 255],
};

const PAGE = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:"><body></body>`;

/**
 * The share of an icon's painted pixels that stand out from the ground. Run in
 * the measuring page, so it is written as source and closes over nothing.
 */
const MEASURE = `async (src, ground) => {
  const image = new Image();
  image.src = src;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, 64, 64);
  const { data } = context.getImageData(0, 0, 64, 64);
  const channel = (value) => {
    const part = value / 255;
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (r, g, b) =>
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const under = luminance(...ground);
  let painted = 0;
  let distinct = 0;
  for (let at = 0; at < data.length; at += 4) {
    if (data[at + 3] < 128) continue;
    painted += 1;
    const over = luminance(data[at], data[at + 1], data[at + 2]);
    const contrast =
      (Math.max(over, under) + 0.05) / (Math.min(over, under) + 0.05);
    if (contrast >= 1.5) distinct += 1;
  }
  return painted === 0 ? 0 : distinct / painted;
}`;

/** An icon with less than this of it standing out is as good as invisible. */
const MIN_DISTINCT_SHARE = 0.05;

let open: BrowserWindow | undefined;
let idleClose: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();

/**
 * Whether an SVG icon can be seen on the app's surfaces in a theme, for an
 * icon that is dark ink on nothing and has no dark version. Measured as drawn,
 * since what an SVG paints cannot be read off its source, and only in the
 * theme the app is in, which is the one an adapting SVG draws itself for.
 * Undefined when it could not be measured.
 */
export function isSvgLegible(
  svg: Buffer,
  theme: Theme,
): Promise<boolean | undefined> {
  const run = queue.then(() => measure(svg, theme)).catch(() => undefined);
  queue = run;
  return run;
}

async function measure(svg: Buffer, theme: Theme) {
  if (nativeTheme.shouldUseDarkColors !== (theme === "dark")) {
    return undefined;
  }
  clearTimeout(idleClose);
  try {
    const window = await measuringWindow();
    const src = `data:image/svg+xml;base64,${svg.toString("base64")}`;
    const share: unknown = await Promise.race([
      window.webContents.executeJavaScript(
        `(${MEASURE})(${JSON.stringify(src)}, ${JSON.stringify(GROUNDS[theme])})`,
      ),
      new Promise((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error("Measuring a site icon timed out"));
        }, MEASURE_TIMEOUT_MS);
      }),
    ]);
    return typeof share === "number" ? share >= MIN_DISTINCT_SHARE : undefined;
  } catch (error) {
    // A page stuck on one icon is not handed the next.
    open?.destroy();
    open = undefined;
    throw error;
  } finally {
    idleClose = setTimeout(() => {
      open?.destroy();
      open = undefined;
    }, IDLE_CLOSE_MS);
  }
}

async function measuringWindow() {
  if (open && !open.isDestroyed()) {
    return open;
  }
  const measuring = session.fromPartition("site-icon-legibility");
  measuring.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  measuring.setPermissionCheckHandler(() => false);
  // An icon is measured from its bytes and reaches nothing.
  measuring.webRequest.onBeforeRequest(({ url }, callback) => {
    callback({ cancel: !url.startsWith("data:") });
  });
  const window = new BrowserWindow({
    focusable: false,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: measuring,
    },
  });
  open = window;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`,
  );
  return window;
}
