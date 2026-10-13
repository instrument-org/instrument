/**
 * Turning a microphone's raw level into something worth looking at.
 *
 * Loudness is logarithmic and RMS is not. Speech through a low-gain built-in
 * microphone sits near 0.01 linear, one percent of the range a linear meter
 * draws, so the bars would stay flat while someone talked normally. Everything
 * here works in dBFS for that reason.
 *
 * The harder half is how much to adapt. Capture runs with automatic gain
 * control, whose whole job is to hold speech at a steady level, so there is
 * little variation left in the signal. Normalizing hard against the recent
 * peak would stretch that leftover wobble across the full height of the
 * meter, and the bars would sit pinned at the top for as long as anyone
 * talked.
 *
 * So the window is mostly fixed and moves slowly. It starts somewhere sensible
 * for a microphone with gain control in front of it, then eases toward what it
 * actually hears: a top a little above where speech settles, a bottom a little
 * above the room. Both are clamped, both take seconds rather than frames, and
 * the span has a minimum, so ordinary variation is drawn as ordinary variation
 * and only a real peak reaches the top of the frame.
 */

/** Where the window sits before it has heard anything. */
const START_TOP_DB = -14;
const START_BOTTOM_DB = -58;

/** How far what it hears may move each edge. */
const TOP_LIMIT = { high: -6, low: -34 };
const BOTTOM_LIMIT = { high: -30, low: -78 };

/** Peaks live this far above the level speech settles at. */
const HEADROOM_DB = 11;
/** And the bottom of the frame never climbs closer than this to that level. */
const DISPLAY_RANGE_DB = 30;
/** A frame this far above the room is speech rather than the room. */
const SPEECH_MARGIN_DB = 6;

/**
 * The room is the quietest thing heard recently, held as a plain trailing
 * minimum over a few seconds of frames.
 *
 * A decaying estimate starts low and climbs, so for its first several seconds
 * everything is above it, steady room noise counts as speech, and the window
 * centers on the noise. A minimum converges on whatever is actually there
 * within one window, and it cannot chase speech upward, because speech has
 * gaps in it and the gaps are what it keeps.
 */
const ROOM_WINDOW = 24;
/** Narrower than this and ordinary variation would fill the frame. */
const MIN_SPAN_DB = 26;

/** Seconds to cover most of the distance to a new estimate. */
const ADAPT_SECONDS = 2.5;

/** Digital silence is negative infinity, which no amount of arithmetic survives. */
const SILENT_DB = -95;

const clamp = (value: number, low: number, high: number) =>
  value < low ? low : value > high ? high : value;

/** Fraction of the remaining distance to cover in this frame, however long it was. */
const ease = (elapsedSeconds: number) =>
  1 - Math.exp(-elapsedSeconds / ADAPT_SECONDS);

/** A frame's RMS, as heard at `atMs`, scaled to 0..1 for drawing. */
export type LevelScale = (rms: number, atMs: number) => number;

/** One per recording: the window it learns belongs to that microphone in that room. */
export function createLevelScale(): LevelScale {
  let top = START_TOP_DB;
  let bottom = START_BOTTOM_DB;
  let speech = START_TOP_DB - HEADROOM_DB;
  let last: number | undefined;
  const recent: number[] = [];

  return (rms, atMs) => {
    // Capped, so a window coming back from the background does not adapt in
    // one jump.
    const elapsed =
      last === undefined ? 0 : clamp((atMs - last) / 1000, 0, 0.5);
    last = atMs;

    const db = clamp(20 * Math.log10(Math.max(rms, 1e-6)), SILENT_DB, 0);
    if (elapsed === 0) {
      return 0;
    }

    recent.push(db);
    if (recent.length > ROOM_WINDOW) {
      recent.shift();
    }
    const room = Math.min(...recent);

    // Speech: an average of the frames that are clearly not the room, so one
    // shout does not redefine the top of the meter for the next few seconds.
    if (db > room + SPEECH_MARGIN_DB) {
      speech += (db - speech) * ease(elapsed);
    }

    const wantTop = clamp(speech + HEADROOM_DB, TOP_LIMIT.low, TOP_LIMIT.high);
    const wantBottom = clamp(
      Math.max(room + 2, speech - DISPLAY_RANGE_DB),
      BOTTOM_LIMIT.low,
      BOTTOM_LIMIT.high,
    );

    top += (wantTop - top) * ease(elapsed);
    bottom += (wantBottom - bottom) * ease(elapsed);
    if (top - bottom < MIN_SPAN_DB) {
      bottom = top - MIN_SPAN_DB;
    }

    return clamp((db - bottom) / (top - bottom), 0, 1);
  };
}

/** The RMS of one frame of samples in -1..1. */
export function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return samples.length === 0 ? 0 : Math.sqrt(sum / samples.length);
}
