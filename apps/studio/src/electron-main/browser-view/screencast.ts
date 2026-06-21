import type { Protocol } from "devtools-protocol";

import type { BrowserEntry } from "./entry";

import { log } from "./log";

const SCREENCAST_INTERVAL_MS = 100;

export function startScreencast({
  entry,
  format,
  maxHeight,
  maxWidth,
  quality,
}: {
  entry: BrowserEntry;
  format: Protocol.Page.StartScreencastRequest["format"];
  maxHeight: number;
  maxWidth: number;
  quality: number;
}) {
  stopScreencast(entry);
  entry.screencastSessionId += 1;
  const screencastSessionId = entry.screencastSessionId;
  const { targetId } = entry;
  let inFlight = false;

  const captureAndEmit = () => {
    // Backpressure: skip this tick if the previous capture hasn't resolved.
    // Prevents pile-up if encoding/IPC is slower than SCREENCAST_INTERVAL_MS.
    if (inFlight) {
      return;
    }
    // electron/electron#50249: webContents is undefined after destruction in Electron 41+
    const wc = entry.view.webContents;
    if (!wc || wc.isDestroyed()) {
      stopScreencast(entry);
      return;
    }
    inFlight = true;
    wc.capturePage({ height: maxHeight, width: maxWidth, x: 0, y: 0 })
      .then((image) => {
        // Stale: a new screencast session started, or the WebContents was
        // destroyed while the capture was pending.
        if (entry.screencastSessionId !== screencastSessionId) {
          return;
        }
        const current = entry.view.webContents;
        if (!current || current.isDestroyed()) {
          return;
        }
        const data =
          format === "png"
            ? image.toPNG().toString("base64")
            : image.toJPEG(quality).toString("base64");
        const frame: Protocol.Page.ScreencastFrameEvent = {
          data,
          metadata: {
            deviceHeight: maxHeight,
            deviceWidth: maxWidth,
            offsetTop: 0,
            pageScaleFactor: 1,
            scrollOffsetX: 0,
            scrollOffsetY: 0,
            timestamp: Date.now() / 1000,
          },
          sessionId: screencastSessionId,
        };
        for (const listener of entry.eventListeners) {
          listener("Page.screencastFrame", frame);
        }
      })
      .catch((error: unknown) => {
        log.warn(
          `screencast capture failed targetId=${targetId} err=${String(error)}`,
        );
      })
      .finally(() => {
        inFlight = false;
      });
  };

  entry.screencastInterval = setInterval(
    captureAndEmit,
    SCREENCAST_INTERVAL_MS,
  );
  captureAndEmit();
}

export function stopScreencast(entry: BrowserEntry) {
  if (entry.screencastInterval !== null) {
    clearInterval(entry.screencastInterval);
    entry.screencastInterval = null;
  }
}
