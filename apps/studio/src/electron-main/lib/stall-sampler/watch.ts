/** How often main bumps the heartbeat, and how often the sampler reads it. */
export const BEAT_MS = 250;

/**
 * The first silence the sampler reports, while it is still going. Shorter
 * stalls are left to main's own timer (`main-thread-stalls.ts`), which says
 * what ran during one once it is over.
 */
export const FIRST_REPORT_MS = 1000;

/**
 * A sample this late means the sampler itself was not running (the computer
 * slept without saying so, or the process was paused), so the silence it
 * would measure is not main's.
 */
const SAMPLER_PAUSE_MS = BEAT_MS * 4;

/** Slots in the shared heartbeat: a counter main bumps, and a suspended flag. */
export const HEARTBEAT_SLOT = 0;
export const SUSPENDED_SLOT = 1;
export const HEARTBEAT_SLOTS = 2;

/**
 * Decides, sample by sample, when main has been silent long enough to say so.
 * Reports at {@link FIRST_REPORT_MS} and then each time the silence doubles,
 * so a hang that never ends leaves a few lines rather than one per sample.
 */
export function createStallWatch(start: number) {
  let lastBeat: number | undefined;
  let lastChange = start;
  let lastSample = start;
  let nextReport = FIRST_REPORT_MS;

  return {
    /** The silence to report now, in whole ms, or undefined for none. */
    sample({
      beat,
      now,
      suspended,
    }: {
      beat: number;
      now: number;
      suspended: boolean;
    }): number | undefined {
      const samplerPaused = now - lastSample > SAMPLER_PAUSE_MS;
      lastSample = now;
      if (beat !== lastBeat || suspended || samplerPaused) {
        lastBeat = beat;
        lastChange = now;
        nextReport = FIRST_REPORT_MS;
        return undefined;
      }
      const silent = now - lastChange;
      if (silent < nextReport) {
        return undefined;
      }
      while (nextReport <= silent) {
        nextReport *= 2;
      }
      return Math.round(silent);
    },
  };
}

/** Where the sampler writes, and in which of the two log formats. */
export type StallLogTarget = { format: "jsonl" | "text"; path: string };

const SCOPE = "stallSampler";

/**
 * One log line in the target's format: the dev log's NDJSON entry
 * (`dev-file-logger.ts`), or electron-log's text line for `main.log`.
 */
export function formatStallLine({
  format,
  message,
  time,
}: {
  format: StallLogTarget["format"];
  message: string;
  time: Date;
}): string {
  if (format === "jsonl") {
    return `${JSON.stringify({ level: "warn", msg: message, scope: SCOPE, time: time.toISOString() })}\n`;
  }
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const stamp = `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}.${pad(time.getMilliseconds(), 3)}`;
  return `[${stamp}] [warn] (${SCOPE}) ${message}\n`;
}
