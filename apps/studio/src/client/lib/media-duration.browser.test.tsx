import { describe, expect, it } from "vitest";

import noDurationUrl from "../../tests/fixtures/no-duration.webm?url";
import { readUnknownDuration } from "./media-duration";

// A WebM written live (no Duration element, no Cues), the way MediaRecorder
// writes one, served over HTTP by the test server. A blob URL of the same
// bytes reports its length at once, so it could not tell the fix from none.
function loadMetadata(src: string) {
  const media = document.createElement("audio");
  media.muted = true;
  media.preload = "metadata";
  const loaded = new Promise<HTMLAudioElement>((resolve, reject) => {
    media.addEventListener("loadedmetadata", () => {
      resolve(media);
    });
    media.addEventListener("error", () => {
      reject(new Error(`media error ${media.error?.code ?? "unknown"}`));
    });
  });
  media.src = src;
  return loaded;
}

describe("readUnknownDuration", () => {
  it("reads a live-written WebM's length and goes back to the start", async () => {
    const media = await loadMetadata(noDurationUrl);
    expect(media.duration).toBe(Number.POSITIVE_INFINITY);

    const known = new Promise<void>((resolve) => {
      media.addEventListener("seeked", function onSeeked() {
        if (Number.isFinite(media.duration) && media.currentTime === 0) {
          media.removeEventListener("seeked", onSeeked);
          resolve();
        }
      });
    });
    readUnknownDuration(media);
    await known;

    expect(media.duration).toBeGreaterThan(5.5);
    expect(media.duration).toBeLessThan(6.5);
    expect(media.currentTime).toBe(0);
  });
});
