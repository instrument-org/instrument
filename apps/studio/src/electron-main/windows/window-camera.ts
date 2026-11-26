import {
  type WindowCamera,
  type WindowMask,
} from "@instrument-org/workspace/electron";
import {
  BrowserWindow,
  nativeImage,
  type WebFrameMain,
  webContents,
} from "electron";
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
 * The world the field script runs in: one of its own, apart from the page's,
 * so a page's scripts neither see it run nor change what the DOM tells it.
 */
const FIELDS_WORLD = 1079;

/**
 * Where each field whose text is a secret is on screen (a password, a new
 * one, a one-time code; a page that shows its password as text keeps the
 * field's `autocomplete`), and the field the keyboard is in, as fractions of
 * the viewport. Run in a page's main frame, it reads the frames of the same
 * origin inside it too, placing their fields through each frame's box.
 */
const SECRET_FIELDS_UP = `(() => {
  const SECRET = 'input[type=password], input[autocomplete~="current-password"], input[autocomplete~="new-password"], input[autocomplete~="one-time-code"]';
  const NOT_TYPED = ["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"];
  const isTyping = (field) => field !== null && (field.tagName === "TEXTAREA" ||
    (field.tagName === "INPUT" && !NOT_TYPED.includes(field.type)) ||
    field.isContentEditable === true);
  const boxes = [];
  const visit = (doc, dx, dy) => {
    const typing = doc.activeElement;
    for (const field of [...doc.querySelectorAll(SECRET), ...(isTyping(typing) ? [typing] : [])]) {
      if (doc.defaultView.getComputedStyle(field).visibility === "hidden") continue;
      const box = field.getBoundingClientRect();
      boxes.push({ bottom: box.bottom + dy, left: box.left + dx, right: box.right + dx, top: box.top + dy });
    }
    for (const frame of doc.querySelectorAll("iframe, frame")) {
      let inner = null;
      try { inner = frame.contentDocument; } catch {}
      if (inner) {
        const box = frame.getBoundingClientRect();
        visit(inner, dx + box.left + frame.clientLeft, dy + box.top + frame.clientTop);
      }
    }
  };
  visit(document, 0, 0);
  return boxes.flatMap((box) => {
    const left = Math.max(0, box.left), top = Math.max(0, box.top);
    const right = Math.min(innerWidth, box.right), bottom = Math.min(innerHeight, box.bottom);
    return right - left > 1 && bottom - top > 1
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
          const fields = isReadFromMain(frame, mainFrame)
            ? []
            : await withDeadline(
                frame === mainFrame
                  ? // Cast: Electron types the script's answer as `any`.
                    (contents.executeJavaScriptInIsolatedWorld(FIELDS_WORLD, [
                      { code: SECRET_FIELDS_UP },
                    ]) as Promise<unknown>)
                  : // Electron runs a script in a world of its own only in
                    // a page's main frame, so a frame of another origin is
                    // asked in its own.
                    frame.executeJavaScript(SECRET_FIELDS_UP),
              ).catch(() => undefined);
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

/**
 * Whether the main frame's script reads a frame's fields itself: a frame
 * below it whose every frame up to the main one is of the main one's origin,
 * which an opaque origin never is.
 */
function isReadFromMain(frame: WebFrameMain, mainFrame: WebFrameMain) {
  if (frame === mainFrame || mainFrame.origin === "null") {
    return false;
  }
  for (let up: WebFrameMain | null = frame; up !== mainFrame; up = up.parent) {
    if (up === null || up.origin !== mainFrame.origin) {
      return false;
    }
  }
  return true;
}

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
