import { alarms } from "@instrument-org/shared/alarms";

/**
 * How much a part of the app may write to its log within an hour, or a day,
 * before it is worth a warning. The main log rotates at 8 MB and a problem
 * report carries its last 512 KB, so one scope writing a megabyte an hour
 * pushes everything else out of the report, and the whole log taking 4 MB an
 * hour is half a rotation. A scope writing a megabyte a day stays under the
 * hourly limit yet takes an eighth of a rotation every day; the busiest scope
 * on a typical install writes a fifth of that.
 */
const LOG_VOLUME_LIMITS = {
  scopeBytes: 1_000_000,
  scopeDayBytes: 1_000_000,
  totalBytes: 4_000_000,
};

/** The rolling hour is six ten-minute buckets, so a total costs six adds. */
const BUCKET_MS = 10 * 60_000;
const BUCKETS = 6;
/** The rolling day is 24 hour-long buckets. */
const DAY_BUCKET_MS = 60 * 60_000;
const DAY_BUCKETS = 24;
/** Scopes counted apart before the rest share one total. */
const MAX_SCOPES = 200;

const NONE = "(none)";
const OTHER = "(other)";

/** A rolling window of buckets, as many as the window has. */
type Hour = { epoch: number; bytes: number }[];

const freshHour = (buckets = BUCKETS): Hour =>
  Array.from({ length: buckets }, () => ({ epoch: -1, bytes: 0 }));

/** Adds `bytes` to the bucket of `epoch` and returns the window's total. */
function add(hour: Hour, epoch: number, bytes: number) {
  const bucket = hour[epoch % hour.length];
  if (bucket && bucket.epoch !== epoch) {
    bucket.epoch = epoch;
    bucket.bytes = 0;
  }
  if (bucket) {
    bucket.bytes += bytes;
  }
  return totalOf(hour, epoch);
}

function totalOf(hour: Hour, epoch: number) {
  let total = 0;
  for (const each of hour) {
    if (each.epoch > epoch - hour.length) {
      total += each.bytes;
    }
  }
  return total;
}

function megabytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * Counts the bytes each log scope writes over a rolling hour, and warns when
 * one scope or the whole log writes past the limits. What it warns is not
 * counted, so a warning cannot raise another. Observation only: `wrote`
 * swallows its own failures.
 */
export function createLogVolumeMeter({
  warn,
  now = Date.now,
  gate = alarms,
  limits = LOG_VOLUME_LIMITS,
}: {
  warn: (line: string) => void;
  now?: () => number;
  gate?: Pick<typeof alarms, "raise">;
  limits?: typeof LOG_VOLUME_LIMITS;
}) {
  const scopes = new Map<string, Hour>();
  const days = new Map<string, Hour>();
  /**
   * When a scope may next warn for its day: a day after it last warned for
   * its hour or its day, so a burst the hourly line named, or one slow
   * scope, costs one day line a day rather than one an hour.
   */
  const dayQuietUntil = new Map<string, number>();
  const all = freshHour();
  let warning = false;

  const say = (line: string) => {
    warning = true;
    try {
      warn(line);
    } finally {
      warning = false;
    }
  };

  const mostWritten = (epoch: number) =>
    [...scopes]
      .map(([scope, hour]) => [scope, totalOf(hour, epoch)] as const)
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([scope, bytes]) => `${scope} ${megabytes(bytes)}`)
      .join(", ");

  return {
    /** Counts a line of `bytes` written under `scope`. */
    wrote(scope: string | undefined, bytes: number) {
      if (warning) {
        return;
      }
      try {
        const epoch = Math.floor(now() / BUCKET_MS);
        const named = scope || NONE;
        const name =
          scopes.has(named) || scopes.size < MAX_SCOPES ? named : OTHER;
        let hour = scopes.get(name);
        if (!hour) {
          hour = freshHour();
          scopes.set(name, hour);
        }
        const scopeTotal = add(hour, epoch, bytes);
        let day = days.get(name);
        if (!day) {
          day = freshHour(DAY_BUCKETS);
          days.set(name, day);
        }
        const scopeDayTotal = add(
          day,
          Math.floor(now() / DAY_BUCKET_MS),
          bytes,
        );
        const total = add(all, epoch, bytes);
        if (
          scopeTotal > limits.scopeBytes &&
          gate.raise(
            `log-volume:scope:${name}`,
            () =>
              `Log volume: ${name} wrote ${megabytes(scopeTotal)} to the log within an hour`,
            say,
          )
        ) {
          dayQuietUntil.set(name, now() + DAY_BUCKET_MS * DAY_BUCKETS);
        }
        if (
          scopeDayTotal > limits.scopeDayBytes &&
          (dayQuietUntil.get(name) ?? -Infinity) <= now() &&
          gate.raise(
            `log-volume:day:${name}`,
            () =>
              `Log volume: ${name} wrote ${megabytes(scopeDayTotal)} to the log within a day`,
            say,
          )
        ) {
          dayQuietUntil.set(name, now() + DAY_BUCKET_MS * DAY_BUCKETS);
        }
        if (total > limits.totalBytes) {
          gate.raise(
            "log-volume:total",
            () =>
              `Log volume: the log took ${megabytes(total)} within an hour (most: ${mostWritten(epoch)})`,
            say,
          );
        }
      } catch {
        // Counting never gets in the way of the line, which is written.
      }
    },
  };
}
