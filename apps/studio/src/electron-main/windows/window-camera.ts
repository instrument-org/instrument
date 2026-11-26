import {
  type WindowCamera,
  type WindowMask,
} from "@instrument-org/workspace/electron";
import { BrowserWindow, nativeImage, webContents } from "electron";
import { z } from "zod";

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
 * Runs in each frame of a page: where each field whose text is a secret is
 * on screen (a password, a new one, a one-time code; a page that shows its
 * password as text keeps the field's `autocomplete`), and the field the
 * keyboard is in, as fractions of the frame's viewport.
 */
const SECRET_FIELDS_UP = `(() => {
  const secret = [...document.querySelectorAll(
    'input[type=password], input[autocomplete~="current-password"], input[autocomplete~="new-password"], input[autocomplete~="one-time-code"]'
  )];
  const typing = document.activeElement;
  const isTyping = typing instanceof HTMLTextAreaElement ||
    (typing instanceof HTMLInputElement &&
      !["button", "checkbox", "radio", "range", "reset", "submit"].includes(typing.type)) ||
    (typing instanceof HTMLElement && typing.isContentEditable);
  return [...secret, ...(isTyping ? [typing] : [])].flatMap((field) => {
    const box = field.getBoundingClientRect();
    const left = Math.max(0, box.left), top = Math.max(0, box.top);
    const right = Math.min(innerWidth, box.right), bottom = Math.min(innerHeight, box.bottom);
    return right - left > 1 && bottom - top > 1 &&
      getComputedStyle(field).visibility !== "hidden"
      ? [{ height: (bottom - top) / innerHeight, width: (right - left) / innerWidth,
           x: left / innerWidth, y: top / innerHeight }]
      : [];
  });
})()`;

/** What a frame's script answers, held to its shape since a page can change what it returns. */
const WindowBoxesSchema = z.array(
  z.object({
    height: z.number(),
    width: z.number(),
    x: z.number(),
    y: z.number(),
  }),
);

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
      const { mainFrame } = contents;
      const frames = mainFrame.framesInSubtree;
      const read = await Promise.all(
        frames.map(async (frame) => {
          const loaded = guests.documentOf(contents.id, frame);
          // A frame that has loaded nothing of its own has what its page
          // wrote into it, which is the page's.
          const document =
            loaded ??
            (/^about:|^$/.test(frame.url) ? "about:blank" : undefined);
          const answer: Promise<unknown> =
            frame.executeJavaScript(SECRET_FIELDS_UP);
          const fields = await withDeadline(answer).catch(() => undefined);
          return { document, fields, frame };
        }),
      );
      const documents = read.flatMap(({ document }) => document ?? []);
      const main = read.find(({ frame }) => frame === mainFrame);
      const fields = WindowBoxesSchema.safeParse(main?.fields);
      return documents.length === frames.length && fields.success
        ? {
            documents,
            fields: fields.data,
            // A frame's own fields can't be placed in the page, nor can
            // those of a frame that would not say.
            hasFrameField: read.some(
              ({ fields: each, frame }) =>
                frame !== mainFrame &&
                !(Array.isArray(each) && each.length === 0),
            ),
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
 * Paints over every part a mask names, in place. A part's edges go out to
 * the next whole pixel, so nothing of what is left out is left.
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
  for (const box of mask.blanked) {
    const from = Math.max(0, Math.floor(box.x * width));
    const to = Math.min(width, Math.ceil((box.x + box.width) * width));
    const bottom = Math.min(height, Math.ceil((box.y + box.height) * height));
    for (let y = Math.max(0, Math.floor(box.y * height)); y < bottom; y += 1) {
      if (to > from) {
        pixels.fill(GRAY, y * width + from, y * width + to);
      }
    }
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
