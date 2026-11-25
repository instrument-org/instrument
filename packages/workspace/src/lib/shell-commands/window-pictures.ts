import { AsyncLocalStorage } from "node:async_hooks";

/** The picture of the window a call's commands last took, blanked, as a PNG. */
export interface WindowPictures {
  last?: Buffer;
}

const storage = new AsyncLocalStorage<WindowPictures>();

/**
 * Runs a bash call with `pictures` collecting the picture its commands take
 * of the window, which its result shows the model. It is in no file, so a
 * command that outlives the call has no way to hand one on.
 */
export function withWindowPictures<T>(
  pictures: WindowPictures,
  run: () => T,
): T {
  return storage.run(pictures, run);
}

/** Keeps the newest, so one call adds a single picture to the context. */
export function recordWindowPicture(picture: Buffer): void {
  const pictures = storage.getStore();
  if (pictures) {
    pictures.last = picture;
  }
}
