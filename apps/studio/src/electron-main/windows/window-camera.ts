import {
  type WindowCamera,
  type WindowMask,
} from "@instrument-org/workspace/electron";
import { BrowserWindow, nativeImage, webContents } from "electron";

import { captureFrame } from "../browser-view/capture-frame";
import { guests } from "../browser-view/guest-registry";
import { createScopedLogger } from "../lib/electron-logger";
import { isDrivenInstance } from "./on-screen";

const log = createScopedLogger("WindowCamera");

/** How long a frame is waited for. */
const DEADLINE_MS = 2000;
/** How long a frame of a page has to answer. */
const FRAME_ANSWER_MS = 1000;

/**
 * Runs in each frame of a page: whether a field for a password, a new one, or
 * a one-time code is on screen. A page that shows its password as text keeps
 * the field's `autocomplete`.
 */
const SIGN_IN_UP = `(() => [...document.querySelectorAll(
  'input[type=password], input[autocomplete~="current-password"], input[autocomplete~="new-password"], input[autocomplete~="one-time-code"]'
)].some((field) => {
  const box = field.getBoundingClientRect();
  return box.width > 1 && box.height > 1 && box.bottom > 0 && box.right > 0 &&
    box.top < innerHeight && box.left < innerWidth &&
    getComputedStyle(field).visibility !== "hidden";
}))()`;

/** Looks at windows and their pages for `instrument window look`. */
export const windowCamera: WindowCamera = {
  capture: async (id) => {
    const contents = webContents.fromId(id);
    const window = contents ? BrowserWindow.fromWebContents(contents) : null;
    if (
      !contents ||
      !window ||
      window.isMinimized() ||
      // An agent's own instance is drawn with its windows held off screen.
      (!window.isVisible() && !isDrivenInstance())
    ) {
      return undefined;
    }
    try {
      const image = await captureFrame(contents, {
        deadlineMs: DEADLINE_MS,
        rejectEmpty: true,
      });
      return {
        masked: (mask) => {
          const { height, width } = image.getSize();
          const bitmap = image.toBitmap();
          blank({ bitmap, height, mask, width });
          return nativeImage
            .createFromBitmap(bitmap, { height, width })
            .toPNG();
        },
      };
    } catch (error) {
      log.info(
        `no frame reason=${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  },
  pageShows: async (tabId) => {
    const record = [...guests.records()].find(
      ({ contents, entry }) =>
        entry?.targetId === tabId && !contents.isDestroyed(),
    );
    if (!record) {
      return undefined;
    }
    const { contents } = record;
    try {
      const frames = contents.mainFrame.framesInSubtree;
      const read = await Promise.all(
        frames.map(async (frame) => {
          const loaded = guests.documentOf(contents.id, frame);
          // A frame that has loaded nothing of its own has what its page
          // wrote into it, which is the page's.
          const document =
            loaded ??
            (/^about:|^$/.test(frame.url) ? "about:blank" : undefined);
          const isSigningIn: unknown = await withDeadline(
            frame.executeJavaScript(SIGN_IN_UP),
          );
          return { document, isSigningIn };
        }),
      );
      const documents = read.flatMap(({ document }) => document ?? []);
      return documents.length === frames.length
        ? {
            documents,
            isSigningIn: read.some(({ isSigningIn }) => isSigningIn !== false),
          }
        : undefined;
    } catch (error) {
      log.info(
        `page not read reason=${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  },
};

/** Four bytes a pixel, the same gray in each color channel, so their order does not matter. */
const GRAY = Buffer.from([0x80, 0x80, 0x80, 0xff]).readUInt32LE();

/**
 * Paints over everything a mask does not show, in place. A part's edges go
 * out to the next whole pixel, so nothing of what is left out is left.
 */
export function blank({
  bitmap,
  height,
  mask,
  width,
}: {
  bitmap: Buffer;
  height: number;
  mask: WindowMask;
  width: number;
}) {
  const pixels = new Uint32Array(
    bitmap.buffer,
    bitmap.byteOffset,
    bitmap.byteLength / 4,
  );
  const fill = (left: number, top: number, right: number, bottom: number) => {
    const from = Math.max(0, Math.floor(left));
    const to = Math.min(width, Math.ceil(right));
    for (
      let y = Math.max(0, Math.floor(top));
      y < Math.min(height, Math.ceil(bottom));
      y += 1
    ) {
      if (to > from) {
        pixels.fill(GRAY, y * width + from, y * width + to);
      }
    }
  };
  const cellWidth = width / mask.columns;
  const cellHeight = height / mask.rows;
  for (let row = 0; row < mask.rows; row += 1) {
    for (let column = 0; column < mask.columns; column += 1) {
      if (mask.shown[row * mask.columns + column] !== true) {
        fill(
          column * cellWidth,
          row * cellHeight,
          (column + 1) * cellWidth,
          (row + 1) * cellHeight,
        );
      }
    }
  }
  for (const box of mask.blanked) {
    fill(
      box.x * width - 1,
      box.y * height - 1,
      (box.x + box.width) * width + 1,
      (box.y + box.height) * height + 1,
    );
  }
}

async function withDeadline<T>(answer: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      answer,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`no answer within ${FRAME_ANSWER_MS.toString()}ms`));
        }, FRAME_ANSWER_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
