import { z } from "zod";

/**
 * A video's storyboard: frames taken at even steps through it, laid in rows
 * on one sprite sheet, which the player's timeline shows under the pointer.
 */
export const StoryboardSchema = z.object({
  columns: z.number(),
  count: z.number(),
  frameHeight: z.number(),
  frameWidth: z.number(),
  /** Seconds between one frame and the next. */
  interval: z.number(),
  /** The file's mtime the sheet was made from, which its URL names. */
  modifiedAt: z.number(),
  rows: z.number(),
});
export type Storyboard = z.output<typeof StoryboardSchema>;

/** How a storyboard is bounded, whatever the video. */
const STORYBOARD_LIMITS = {
  columns: 10,
  /** At most this many frames, so a sheet stays one modest JPEG (about 1600 px wide). */
  frames: 100,
  /** Each frame's width in px; its height follows the video's shape. */
  frameWidth: 160,
  /** Frames no closer than this; a short video gets fewer of them. */
  minIntervalSeconds: 2,
  /** Shorter than this, scrubbing shows enough without previews. */
  minDurationSeconds: 15,
} as const;

/**
 * The storyboard a video of this length and shape gets, or null for one too
 * short to want one, or whose length or shape is unknown.
 */
export function planStoryboard({
  duration,
  height,
  width,
}: {
  duration: number;
  height: number;
  width: number;
}): null | Omit<Storyboard, "modifiedAt"> {
  if (
    !Number.isFinite(duration) ||
    duration < STORYBOARD_LIMITS.minDurationSeconds ||
    !(width > 0) ||
    !(height > 0)
  ) {
    return null;
  }
  const count = Math.min(
    STORYBOARD_LIMITS.frames,
    Math.floor(duration / STORYBOARD_LIMITS.minIntervalSeconds),
  );
  const frameWidth = STORYBOARD_LIMITS.frameWidth;
  // Even, as the encoder wants each side of a frame.
  const frameHeight = Math.max(
    2,
    Math.round((frameWidth * height) / width / 2) * 2,
  );
  const columns = Math.min(STORYBOARD_LIMITS.columns, count);
  return {
    columns,
    count,
    frameHeight,
    frameWidth,
    interval: duration / count,
    rows: Math.ceil(count / columns),
  };
}

/**
 * The storyboard as the WebVTT a `thumbnails` metadata track reads: one cue
 * per frame, naming the sheet with the frame's place on it.
 */
export function storyboardVtt(storyboard: Storyboard, sheetUrl: string) {
  const cues = Array.from({ length: storyboard.count }, (_, index) => {
    const x = (index % storyboard.columns) * storyboard.frameWidth;
    const y = Math.floor(index / storyboard.columns) * storyboard.frameHeight;
    const start = vttTime(index * storyboard.interval);
    const end = vttTime((index + 1) * storyboard.interval);
    return `${start} --> ${end}\n${sheetUrl}#xywh=${x},${y},${storyboard.frameWidth},${storyboard.frameHeight}`;
  });
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

function vttTime(seconds: number) {
  const millis = Math.round(seconds * 1000);
  const hours = Math.floor(millis / 3_600_000);
  const minutes = Math.floor((millis % 3_600_000) / 60_000);
  const rest = (millis % 60_000) / 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${rest.toFixed(3).padStart(6, "0")}`;
}
