/**
 * Replaces `@/client/rpc/client` in the browser build (see the alias in
 * `web/vite.config.ts`).
 *
 * The real module opens a `MessageChannel` to the preload, which is the
 * renderer's only channel to the main process and, through it, to the
 * workspace server. Rather than reimplement the oRPC wire protocol over that
 * port, this swaps the module out and hands the same tanstack-query utils a
 * client backed by fixtures.
 *
 * Every call is recorded whether or not a fixture exists, so
 * `window.__rpcCalls.report()` in DevTools tells you exactly which procedures
 * a screen needs.
 */
/* eslint-disable no-console -- the console output is this module's product:
   it is how a missing fixture is discovered. */
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import { FIXTURES, MUTATIONS } from "./fixtures";

declare global {
  interface Window {
    __rpcCalls: {
      missing: () => string[];
      report: () => void;
      seen: Map<string, { count: number; fixture: boolean }>;
      subscribers: () => Record<string, number>;
    };
  }
}

const seen = new Map<string, { count: number; fixture: boolean }>();

type Subscriber = (value: unknown) => void;

/**
 * `createTanstackQueryUtils` walks the client lazily (`client[prop]` inside its
 * own proxy's get trap) and only ever calls the leaf as `client(input, opts)`,
 * so one self-returning callable proxy satisfies the whole router shape without
 * enumerating 171 procedures.
 */
function createMockClient(path: string[] = []): unknown {
  const call = (input: unknown) => resolve(path, input);
  return new Proxy(call, {
    get(target, prop) {
      if (typeof prop !== "string") {
        // A get trap forwarding a symbol to its target is what Reflect.get is
        // for; anything else here needs a cast to index the function by symbol.
        // oxlint-disable-next-line anti-slop/no-reflect-get
        return Reflect.get(target, prop) as unknown;
      }
      // Anything awaiting the proxy itself would otherwise treat `then` as
      // another path segment and hang.
      if (prop === "then") {
        return;
      }
      return createMockClient([...path, prop]);
    },
  });
}

const subscribers = new Map<string, Set<Subscriber>>();

/**
 * Feeds a value to everything currently iterating `path`. The app-command bus
 * is the reason this exists: those commands originate from the native menu in
 * Electron, so in the browser something has to stand in as the producer.
 */
export function pushLive(path: string, value: unknown) {
  for (const notify of subscribers.get(path) ?? []) {
    notify(value);
  }
}

/**
 * Paths a producer pushes to, which therefore have to stay subscribed:
 * app commands come from the browser keymap, preferences from the setters in
 * {@link MUTATIONS}.
 *
 * Everything else completes after its one fixture value, because
 * `experimental_liveQuery` resolves its promise only when the stream *ends*.
 * It calls `setQueryData` per chunk, so an open stream still shows data, but
 * the query stays pending, which downstream reads as `isLoading`.
 */
const OPEN_STREAM_PATHS = new Set([
  "appCommands.events.command",
  "preferences.live.get",
]);

/** The two router segments that mark an oRPC event iterator. */
const STREAM_SEGMENTS = new Set(["events", "live"]);

/**
 * Procedures under a streaming segment are oRPC event iterators: callers consume
 * them with `for await`, so resolving to `undefined` throws on
 * `Symbol.asyncIterator` rather than degrading.
 *
 * Returns the generator object itself rather than a bare `[Symbol.asyncIterator]`
 * wrapper: `experimental_liveOptions` runs `isAsyncIteratorObject`, which also
 * requires `next`, and rejects a plain async iterable outright.
 */
function liveStream(path: string, initial: unknown) {
  async function* stream() {
    const staysOpen = OPEN_STREAM_PATHS.has(path);

    if (initial !== undefined) {
      yield initial;
    } else if (!staysOpen) {
      // `experimental_liveQuery` throws "did not yield any data" on a stream
      // that ends empty, which turns every live procedure without a fixture
      // into a crash instead of an absent value. Null settles the query and
      // lets the screen render whatever it shows for "nothing here".
      yield null;
    }

    if (!staysOpen) {
      return;
    }

    const queue: unknown[] = [];
    let wake: (() => void) | undefined;
    const notify: Subscriber = (value) => {
      queue.push(value);
      wake?.();
    };

    const set = subscribers.get(path) ?? new Set<Subscriber>();
    set.add(notify);
    subscribers.set(path, set);

    try {
      while (true) {
        while (queue.length > 0) {
          yield queue.shift();
        }
        await new Promise<void>((wakeUp) => {
          wake = wakeUp;
        });
        wake = undefined;
      }
    } finally {
      set.delete(notify);
    }
  }

  return stream();
}

function record(path: string, fixture: boolean) {
  const entry = seen.get(path) ?? { count: 0, fixture };
  entry.count += 1;
  seen.set(path, entry);
}

function resolve(path: string[], input: unknown): Promise<unknown> {
  const key = path.join(".");

  const mutate = MUTATIONS[key];
  if (mutate) {
    record(key, true);
    for (const [livePath, value] of mutate(input as never)) {
      pushLive(livePath, value);
    }
    // The real setters return void; callers re-read from the live stream.
    return Promise.resolve();
  }

  const has = key in FIXTURES;
  record(key, has);

  if (!has) {
    console.warn(`[web] no fixture for ${key}`, input);
  }

  const raw = FIXTURES[key];
  const value =
    typeof raw === "function" ? (raw as (i: unknown) => unknown)(input) : raw;

  return Promise.resolve(
    path.some((segment) => STREAM_SEGMENTS.has(segment))
      ? liveStream(key, value)
      : value,
  );
}

window.__rpcCalls = {
  missing: () =>
    [...seen.entries()]
      .filter(([, v]) => !v.fixture)
      .map(([k]) => k)
      .sort(),
  report: () => {
    const rows = [...seen.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, v]) => ({ calls: v.count, fixture: v.fixture, path }));
    console.table(rows);
    const missing = rows.filter((r) => !r.fixture).length;
    console.log(
      `${rows.length} procedures called, ${missing} without fixtures`,
    );
  },
  seen,
  // How many open streams each path currently has. Zero where you
  // expect one means a mutation's re-yield is going nowhere.
  subscribers: () =>
    Object.fromEntries([...subscribers].map(([path, set]) => [path, set.size])),
};

// oxlint-disable-next-line typescript/no-unsafe-argument
export const rpcClient = createTanstackQueryUtils(createMockClient() as never);

/* eslint-enable no-console */
