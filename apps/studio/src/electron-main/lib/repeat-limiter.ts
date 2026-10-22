/** What a limiter decided about one occurrence of a key. */
export type RepeatDecision = {
  allowed: boolean;
  /** On an allowed occurrence, how many of the key's were held back before it. */
  suppressed: number;
};

/**
 * Let through at most `limit` occurrences of each key per `intervalMs`,
 * counting the rest, so a loop that repeats one thing cannot repeat its cost.
 *
 * A key's interval starts at its first occurrence. The first occurrence after
 * an interval ends starts the next one and carries the count held back in the
 * last, for whoever records it to say so. At most `maxKeys` keys are tracked,
 * the one whose interval started longest ago forgotten first.
 */
export function createRepeatLimiter({
  intervalMs,
  limit,
  maxKeys = 500,
}: {
  intervalMs: number;
  limit: number;
  maxKeys?: number;
}) {
  const intervals = new Map<
    string,
    { seen: number; startedAt: number; suppressed: number }
  >();

  return (key: string, now = Date.now()): RepeatDecision => {
    const current = intervals.get(key);
    if (current && now - current.startedAt < intervalMs) {
      current.seen += 1;
      if (current.seen > limit) {
        current.suppressed += 1;
        return { allowed: false, suppressed: 0 };
      }
      return { allowed: true, suppressed: 0 };
    }
    // Deleted before it is set again, so insertion order stays start order.
    intervals.delete(key);
    intervals.set(key, { seen: 1, startedAt: now, suppressed: 0 });
    while (intervals.size > maxKeys) {
      const oldest = intervals.keys().next();
      if (oldest.done) {
        break;
      }
      intervals.delete(oldest.value);
    }
    return { allowed: true, suppressed: current?.suppressed ?? 0 };
  };
}
