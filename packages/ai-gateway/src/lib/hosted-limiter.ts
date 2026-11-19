/**
 * Our platform admits so many hosted requests per account at once (past
 * that, 429 `concurrency-limit`) and so many a minute (past that, 429
 * `rate-limit-exceeded`), counted across every chat and device. The limiter
 * keeps this app under both: a request past either waits its turn here and
 * goes out once there is room, so a burst of work is paced instead of
 * refused.
 *
 * Acquire only at the leaf that sends the request (the model proxy, the
 * search and dictation calls), never around a tool or a script that ends at
 * one: a caller holding a slot while it waits for another can deadlock.
 *
 * Waiting requests queue per key (a chat's session), and the queues are
 * served in turn, so one chat's fan-out of searches takes one turn in the
 * rotation rather than every free slot. The priority lane (dictation,
 * decisions) is for a person waiting on the answer: it goes ahead of every
 * queue, and agent work leaves one slot free for it.
 *
 * Time spent waiting here counts against the caller's own timeouts, such as
 * a turn's wait for its first chunk.
 */

/** What the platform admits for one account, from its billing status. */
export interface HostedLimits {
  maxInFlight: number;
  perMinute: number;
}

/** Used until the billing status says otherwise: a paid plan's limits. */
export const DEFAULT_HOSTED_LIMITS: HostedLimits = {
  maxInFlight: 8,
  perMinute: 300,
};

export type HostedLane = "agent" | "priority";

/**
 * Frees the slot a request held. `refusal` is the code our platform refused
 * it with, if it did, which the limiter learns from: `concurrency-limit`
 * lowers how many it lets run, and `rate-limit-exceeded` pauses agent work.
 */
export type HostedRelease = (outcome?: { refusal?: string }) => void;

export interface HostedLimiter {
  /**
   * Resolves once the request may go out, with the release to call when it
   * ends. Rejects with the signal's reason (an `AbortError`) if `signal`
   * aborts first, which takes it out of the queue.
   */
  acquire(request: {
    /** The queue it waits in: the chat's session, or "" for none. */
    key: string;
    /** `agent` (the default) is paced under the per-minute limit. */
    lane?: HostedLane;
    signal?: AbortSignal;
  }): Promise<HostedRelease>;
  setLimits(limits: HostedLimits): void;
  snapshot(): { ceiling: number; inFlight: number; queued: number };
}

export interface HostedLimiterClock {
  now(): number;
  /** Runs `run` after `ms`, unless the returned cancel is called first. */
  schedule(run: () => void, ms: number): () => void;
}

const systemClock: HostedLimiterClock = {
  now: () => Date.now(),
  schedule: (run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
};

/**
 * The share of the per-minute limit agent work is paced at. The platform's
 * rate limiter is eventually consistent, so pacing right at the limit would
 * still draw refusals.
 */
const PACE_SHARE = 0.9;
const MINUTE_MS = 60_000;
/** How long agent work waits after a `rate-limit-exceeded` gets through anyway. */
const RATE_REFUSAL_PAUSE_MS = 10_000;

interface Waiter {
  key: string;
  lane: HostedLane;
  onAbort: () => void;
  resolve: (release: HostedRelease) => void;
  signal?: AbortSignal;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The request was aborted.", "AbortError");
}

function sanitized(limits: HostedLimits): HostedLimits {
  return {
    maxInFlight: Math.max(1, Math.floor(limits.maxInFlight) || 1),
    perMinute: Math.max(1, Math.floor(limits.perMinute) || 1),
  };
}

export function createHostedLimiter({
  clock = systemClock,
  limits: initial = DEFAULT_HOSTED_LIMITS,
}: { clock?: HostedLimiterClock; limits?: HostedLimits } = {}): HostedLimiter {
  let limits = sanitized(initial);
  /** How many may run now: the plan's limit, lowered after a concurrency refusal. */
  let ceiling = limits.maxInFlight;
  let inFlight = 0;
  /** When each agent request of the last minute went out, oldest first. */
  let starts: number[] = [];
  let pausedUntil = 0;
  const priority: Waiter[] = [];
  /** Agent queues by key, in the order they are served next. */
  const queues = new Map<string, Waiter[]>();
  let cancelWake: (() => void) | undefined;

  const agentCeiling = () => Math.max(1, ceiling - 1);
  const perMinute = () =>
    Math.max(1, Math.floor(limits.perMinute * PACE_SHARE));

  /** When the next agent request may go out by the pace. */
  function pacedFrom(now: number) {
    starts = starts.filter((at) => at > now - MINUTE_MS);
    const budget = perMinute();
    const windowFull =
      starts.length >= budget
        ? (starts[starts.length - budget] ?? now) + MINUTE_MS
        : 0;
    return Math.max(pausedUntil, windowFull);
  }

  function nextAgent(): undefined | Waiter {
    const first = queues.entries().next();
    if (first.done) {
      return undefined;
    }
    const [key, waiters] = first.value;
    const waiter = waiters.shift();
    // Back of the rotation, behind every other chat's next request.
    queues.delete(key);
    if (waiters.length > 0) {
      queues.set(key, waiters);
    }
    return waiter;
  }

  function admit(waiter: Waiter, now: number) {
    inFlight += 1;
    if (waiter.lane === "agent") {
      starts.push(now);
    }
    waiter.signal?.removeEventListener("abort", waiter.onAbort);
    waiter.resolve(releaseFor(waiter.lane));
  }

  function pump() {
    cancelWake?.();
    cancelWake = undefined;
    const now = clock.now();
    for (
      let waiter = priority[0];
      waiter && inFlight < ceiling;
      waiter = priority[0]
    ) {
      priority.shift();
      admit(waiter, now);
    }
    while (queues.size > 0 && inFlight < agentCeiling()) {
      const at = pacedFrom(now);
      if (at > now) {
        cancelWake = clock.schedule(pump, at - now);
        return;
      }
      const waiter = nextAgent();
      if (waiter) {
        admit(waiter, now);
      }
    }
  }

  function releaseFor(lane: HostedLane): HostedRelease {
    let released = false;
    return (outcome) => {
      if (released) {
        return;
      }
      released = true;
      if (outcome?.refusal === "concurrency-limit") {
        // Another device is using the rest: run one fewer than were running.
        ceiling = Math.max(1, Math.min(ceiling, inFlight) - 1);
      } else {
        ceiling = Math.min(limits.maxInFlight, ceiling + 1);
      }
      // Dictation and decisions are counted against budgets of their own.
      if (lane === "agent" && outcome?.refusal === "rate-limit-exceeded") {
        pausedUntil = clock.now() + RATE_REFUSAL_PAUSE_MS;
      }
      inFlight -= 1;
      pump();
    };
  }

  function remove(waiter: Waiter) {
    if (waiter.lane === "priority") {
      const index = priority.indexOf(waiter);
      if (index !== -1) {
        priority.splice(index, 1);
      }
      return;
    }
    const waiters = queues.get(waiter.key);
    const index = waiters?.indexOf(waiter) ?? -1;
    if (waiters && index !== -1) {
      waiters.splice(index, 1);
      if (waiters.length === 0) {
        queues.delete(waiter.key);
      }
    }
  }

  return {
    acquire: ({ key, lane = "agent", signal }) => {
      if (signal?.aborted) {
        return Promise.reject(abortReason(signal));
      }
      return new Promise<HostedRelease>((resolve, reject) => {
        const waiter: Waiter = {
          key,
          lane,
          onAbort: () => {
            remove(waiter);
            if (signal) {
              reject(abortReason(signal));
            }
          },
          resolve,
          signal,
        };
        if (lane === "priority") {
          priority.push(waiter);
        } else {
          const waiters = queues.get(key);
          if (waiters) {
            waiters.push(waiter);
          } else {
            queues.set(key, [waiter]);
          }
        }
        signal?.addEventListener("abort", waiter.onAbort, { once: true });
        pump();
      });
    },
    setLimits: (next) => {
      const previous = limits;
      limits = sanitized(next);
      ceiling =
        ceiling >= previous.maxInFlight
          ? limits.maxInFlight
          : Math.min(ceiling, limits.maxInFlight);
      pump();
    },
    snapshot: () => ({
      ceiling,
      inFlight,
      queued:
        priority.length +
        [...queues.values()].reduce((sum, waiters) => sum + waiters.length, 0),
    }),
  };
}

/**
 * The response, with `release` called once its body has been read to the
 * end, has failed or been canceled, or `signal` (the client's request)
 * aborts: a streamed completion holds its slot for as long as it streams.
 */
export function releaseWhenBodyEnds(
  response: Response,
  release: HostedRelease,
  signal?: AbortSignal,
): Response {
  if (!response.body) {
    release();
    return response;
  }
  const reader = response.body.getReader();
  const done = () => {
    signal?.removeEventListener("abort", done);
    release();
  };
  if (signal?.aborted) {
    done();
  } else {
    signal?.addEventListener("abort", done, { once: true });
  }
  const body = new ReadableStream<Uint8Array>({
    cancel: async (reason) => {
      done();
      await reader.cancel(reason);
    },
    pull: async (controller) => {
      try {
        const read = await reader.read();
        if (read.done) {
          done();
          controller.close();
          return;
        }
        controller.enqueue(read.value);
      } catch (error) {
        done();
        controller.error(error);
      }
    },
  });
  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}
