import type { NativeImage, Rectangle, WebContents } from "electron";

import { sleep } from "radashi";

import { whileEmbedderComposites } from "./embedder-draw";

/** How long to wait between asks while a contents has no frame to give. */
const RETRY_MS = 50;

/** No frame came before the deadline: the contents drew nothing that could be taken. */
export class FrameNotDrawnError extends Error {
  override name = "FrameNotDrawnError";
}

/** A frame came, and it was empty, for a caller that counts that as no picture. */
export class EmptyFrameError extends Error {
  override name = "EmptyFrameError";
}

/**
 * A frame of what a contents draws now: a tab's guest, or a window drawing a
 * file for its picture. Every picture the main process takes of a page comes
 * through here, so every one of them is bounded and handles a surface nobody
 * can see the same way.
 *
 * - `deadlineMs` bounds the whole wait. A contents with no frame yet can fail
 *   at once (`UnknownVizError`) rather than wait, so a failed capture is asked
 *   again until then; a capture that never answers is given up on at it.
 * - `forceDraw` makes the window hosting a guest draw while this waits. A
 *   guest draws only when its window does, and a window covered by another
 *   app's or minimized does not (see `embedder-draw.ts`).
 * - `rejectEmpty` fails on an empty frame rather than handing it back.
 * - `rect` takes part of the page, in its own coordinates. An offscreen
 *   contents hands over whole frames.
 *
 * An offscreen contents (the Linux file pictures) has no surface to capture:
 * its frames come as it paints, so the next painted frame is the picture, and
 * an empty paint is one the page has not caught up to yet.
 */
export async function captureFrame(
  contents: CapturedContents,
  {
    deadlineMs,
    forceDraw = false,
    rect,
    rejectEmpty = false,
  }: {
    deadlineMs: number;
    forceDraw?: boolean;
    rect?: Rectangle;
    rejectEmpty?: boolean;
  },
): Promise<NativeImage> {
  const deadline = Date.now() + deadlineMs;
  // Set once the deadline has answered, so a capture still in flight stops
  // asking instead of looping on behind a caller that has moved on.
  const given = { up: false };
  let lastError: unknown;

  const ask = async (): Promise<NativeImage> => {
    for (;;) {
      try {
        const image = contents.isOffscreen()
          ? await nextPaintedFrame(contents, given)
          : await (rect ? contents.capturePage(rect) : contents.capturePage());
        if (rejectEmpty && image.isEmpty()) {
          throw new EmptyFrameError("The page drew an empty frame");
        }
        return image;
      } catch (error) {
        if (error instanceof EmptyFrameError) {
          throw error;
        }
        lastError = error;
      }
      if (given.up || Date.now() + RETRY_MS >= deadline) {
        throw notDrawn(deadlineMs, lastError);
      }
      await sleep(RETRY_MS);
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const bounded = Promise.race([
    ask(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          given.up = true;
          reject(notDrawn(deadlineMs, lastError));
        },
        Math.max(0, deadline - Date.now()),
      );
    }),
  ]).finally(() => {
    given.up = true;
    clearTimeout(timer);
  });
  return forceDraw ? whileEmbedderComposites(contents, bounded) : bounded;
}

/** The parts of a web contents a capture uses. */
export type CapturedContents = Pick<
  WebContents,
  "capturePage" | "hostWebContents" | "invalidate" | "isOffscreen" | "once"
>;

/**
 * The next frame an offscreen contents paints with the page as it stands: the
 * view is marked for a repaint so one comes even when nothing on it moves. An
 * empty paint is skipped for the one after it, until the capture is given up.
 */
function nextPaintedFrame(
  contents: CapturedContents,
  given: { up: boolean },
): Promise<NativeImage> {
  return new Promise((resolve) => {
    const onPaint = (
      _event: unknown,
      _dirty: Rectangle,
      image: NativeImage,
    ) => {
      if (image.isEmpty() && !given.up) {
        contents.once("paint", onPaint);
        contents.invalidate();
        return;
      }
      resolve(image);
    };
    contents.once("paint", onPaint);
    contents.invalidate();
  });
}

function notDrawn(deadlineMs: number, cause: unknown) {
  const reason =
    cause instanceof Error
      ? ` (${cause.message})`
      : cause === undefined
        ? ""
        : ` (${JSON.stringify(cause)})`;
  return new FrameNotDrawnError(`No frame within ${deadlineMs}ms${reason}`, {
    cause,
  });
}
