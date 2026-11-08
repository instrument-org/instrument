import { alarms } from "@instrument-org/shared/alarms";

/** A burst reading more rows than this warns. */
const BURST_ROWS = 100;
/** A burst taking longer than this warns. */
const BURST_MS = 200;
/** Rows read again within a rolling minute past this warn. */
const MINUTE_ROWS = 1_000;
/** The first read, which reads every row by design, warns only past this. */
const FIRST_READ_MS = 2_000;
/** The rolling minute is this many buckets of `BUCKET_MS`. */
const BUCKETS = 6;
const BUCKET_MS = 10_000;

/** What made a burst read rows again. */
export type RereadCause = "apps" | "held" | "records" | "refresh";

const CAUSE: Record<RereadCause, string> = {
  apps: "a change to the apps",
  held: "held memory-only changes",
  records: "record changes",
  refresh: "a refresh",
};

function counted(n: number, what: string): string {
  return `${n} ${what}${n === 1 ? "" : "s"}`;
}

/**
 * Counts what each burst of the chat list reads again and warns through the
 * alarm gate when one reads too many rows or takes too long, or when the
 * rows read within a rolling minute pass `MINUTE_ROWS`: a list re-read
 * whole on every event, which sends a window nothing extra and so passes
 * the RPC payload warnings. Constant work and memory per burst, no timers,
 * and it never throws.
 */
export function chatListRereads(now: () => number = () => performance.now()) {
  const rows = Array.from({ length: BUCKETS }, () => 0);
  const reads = Array.from({ length: BUCKETS }, () => 0);
  let slot = Math.floor(now() / BUCKET_MS);
  /** Clears the buckets passed since the last count, up to all of them. */
  const advance = (at: number) => {
    const to = Math.floor(at / BUCKET_MS);
    for (let next = slot + 1; next <= Math.min(to, slot + BUCKETS); next += 1) {
      rows[next % BUCKETS] = 0;
      reads[next % BUCKETS] = 0;
    }
    slot = Math.max(slot, to);
  };
  return {
    /** The first read of a reading, every row. */
    first({ ms, read }: { ms: number; read: number }) {
      try {
        if (ms > FIRST_READ_MS) {
          alarms.raise(
            "chat-list.first-read",
            () =>
              `Chat list: first read of ${counted(read, "row")} took ${Math.round(ms)} ms`,
            console.warn,
          );
        }
      } catch {
        // Counting never gets in the list's way.
      }
    },
    /** A burst after the first read: `read` rows, `fresh` of them new to the list. */
    burst({
      cause,
      fresh,
      listed,
      ms,
      read,
    }: {
      cause: RereadCause;
      fresh: number;
      listed: number;
      ms: number;
      read: number;
    }) {
      try {
        if (read === 0) {
          return;
        }
        advance(now());
        const bucket = slot % BUCKETS;
        rows[bucket] = (rows[bucket] ?? 0) + read;
        reads[bucket] = (reads[bucket] ?? 0) + 1;
        const minuteRows = rows.reduce((sum, count) => sum + count, 0);
        const minuteReads = reads.reduce((sum, count) => sum + count, 0);
        if (read > BURST_ROWS || ms > BURST_MS) {
          alarms.raise(
            `chat-list.burst.${cause}`,
            () =>
              `Chat list: read ${counted(read, "row")} again in ${Math.round(ms)} ms for ${CAUSE[cause]} (${fresh} new to the list; ${counted(minuteRows, "row")} in ${counted(minuteReads, "read")} in the last minute; ${listed} listed)`,
            console.warn,
          );
        }
        if (minuteRows > MINUTE_ROWS) {
          alarms.raise(
            "chat-list.minute",
            () =>
              `Chat list: read ${counted(minuteRows, "row")} again in ${counted(minuteReads, "read")} within a minute (${listed} listed; the last for ${CAUSE[cause]})`,
            console.warn,
          );
        }
      } catch {
        // Counting never gets in the list's way.
      }
    },
  };
}
