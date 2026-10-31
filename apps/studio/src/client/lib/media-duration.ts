/**
 * Has a recording that names no length read to its end, so its controls show
 * how long it is before it is played.
 *
 * A browser's MediaRecorder streams its file out before it knows the length,
 * so the WebM it writes has no duration and no seek index, and Chromium
 * reports `Infinity` until playback reaches the last frame. Seeking past the
 * end makes it find that frame now; once the duration is known the playhead
 * goes back to the start. An autoplaying element keeps playing through it.
 * A file that names its length is left alone.
 */
export function readUnknownDuration(media: HTMLMediaElement) {
  if (Number.isFinite(media.duration)) {
    return;
  }
  const onDurationChange = () => {
    if (!Number.isFinite(media.duration)) {
      return;
    }
    media.removeEventListener("durationchange", onDurationChange);
    media.currentTime = 0;
  };
  media.addEventListener("durationchange", onDurationChange);
  media.currentTime = Number.MAX_SAFE_INTEGER;
}
