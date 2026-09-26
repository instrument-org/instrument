import type { WebContents } from "electron";

import { noop } from "radashi";

// A task browser guest draws only when the Studio window hosting it draws, and
// a Studio window covered by another app's window, or minimized, does not. A
// page the guest navigates to in that state gets a new render widget that never
// presents a frame, so anything waiting on one waits forever: a capture times
// out or fails with UnknownVizError, a CDP screenshot never answers, and input
// is never acknowledged. A page painted before the window was covered keeps
// drawing but still needs new frames to acknowledge input.
//
// Asking the Studio window for a capture of its own makes it draw, which
// presents the guest's pending frame. The capture is one pixel with stayHidden,
// so the window's renderer is never marked visible and nothing in it reacts.
// It is repeated until `work` settles, because one can finish before the
// guest's frame arrives and input wants a frame per event.
export async function whileEmbedderComposites<T>(
  wc: WebContents,
  work: Promise<T>,
): Promise<T> {
  const embedder = wc.hostWebContents;
  if (!embedder) {
    return await work;
  }
  const MAX_EMBEDDER_CAPTURES = 50;
  const drawing = { settled: false };
  void (async () => {
    for (let i = 0; !drawing.settled && i < MAX_EMBEDDER_CAPTURES; i++) {
      if (embedder.isDestroyed()) {
        return;
      }
      await embedder
        .capturePage({ height: 1, width: 1, x: 0, y: 0 }, { stayHidden: true })
        .catch(noop);
    }
  })();
  try {
    return await work;
  } finally {
    drawing.settled = true;
  }
}
