import { alarms } from "@instrument-org/shared/alarms";

/**
 * How much a part of the app may write to its log within an hour before it
 * is worth a warning. The main log rotates at 8 MB and a problem report
 * carries its last 512 KB, so one scope writing a megabyte an hour pushes
 * everything else out of the report, and the whole log taking 4 MB an hour
 * is half a rotation.
 */
const LOG_VOLUME_LIMITS = {
  scopeBytes: 1_000_000,
  totalBytes: 4_000_000,
};

/** The rolling hour is six ten-minute buckets, so a total costs six adds. */
const BUCKET_MS = 10 * 60_000;
const BUCKETS = 6;
/** Scopes counted apart before the rest share one total. */
const MAX_SCOPES = 200;

const NONE = "(none)";
const OTHER = "(other)";

type Hour = { epoch: number; bytes: number }[];

const freshHour = (): Hour =>
  Array.from({ length: BUCKETS }, () => ({ epoch: -1, bytes: 0 }));

/** Adds `bytes` to the bucket of `epoch` and returns the hour's total. */
function add(hour: Hour, epoch: number, bytes: number) {
  const bucket = hour[epoch % BUCKETS];
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
    if (each.epoch > epoch - BUCKETS) {
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
        const total = add(all, epoch, bytes);
        if (scopeTotal > limits.scopeBytes) {
          gate.raise(
            `log-volume:scope:${name}`,
            () =>
              `Log volume: ${name} wrote ${megabytes(scopeTotal)} to the log within an hour`,
            say,
          );
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
