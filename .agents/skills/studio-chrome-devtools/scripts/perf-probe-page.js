// Installed ahead of the renderer's own scripts by perf-screens.mjs and
// perf-chat-turns.mjs (Page.addScriptToEvaluateOnNewDocument, then a reload),
// and read back through window.__perfProbe.
//
// Counts what does not move with machine load, so a run on a busy computer
// still compares with one on a quiet one: React commits and which components
// rendered (through a stand-in for the React DevTools hook), oRPC messages and
// bytes per procedure (by wrapping MessagePort), and DOM mutations. Long
// animation frames are recorded too, and those do move with load: compare
// them only between runs taken side by side.
//
// `watch(names)` also records why each named component rendered: the props
// that changed, its own state, or neither (a context or a parent that does
// not memoize).

/**
 * The part of a React fiber this reads. React does not export the type, and
 * these fields have held from 16 through 19.
 *
 * @typedef {{
 *   alternate: Fiber | null;
 *   child: Fiber | null;
 *   dependencies: { firstContext: unknown } | null;
 *   flags: number;
 *   memoizedProps: Record<string, unknown> | null;
 *   memoizedState: unknown;
 *   sibling: Fiber | null;
 *   tag: number;
 *   type: ComponentType | string | null;
 * }} Fiber
 *
 * @typedef {{
 *   displayName?: string;
 *   name?: string;
 *   render?: { displayName?: string; name?: string };
 *   type?: { displayName?: string; name?: string };
 * }} ComponentType
 *
 * @typedef {{ n: number; bytes: number }} Traffic
 *
 * @typedef {{
 *   at: number;
 *   ms: number;
 *   blocking: number;
 *   style: number;
 *   top: string | undefined;
 * }} LongFrame
 *
 * Chromium's long-animation-frame entry, which the DOM types lack.
 * @typedef {PerformanceEntry & {
 *   blockingDuration: number;
 *   styleAndLayoutStart: number;
 *   scripts: {
 *     duration: number;
 *     invoker: string;
 *     sourceFunctionName: string;
 *     sourceURL: string;
 *   }[];
 * }} LongFrameTiming
 */

(() => {
  if (window.top !== window) {
    return;
  }
  /** React's PerformedWork flag: the fiber ran its render this commit. */
  const PERFORMED_WORK = 1;
  /** Function, class, forwardRef, memo and simple memo components. */
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);

  const state = {
    t0: performance.now(),
    commits: 0,
    commitMs: 0,
    fibersRendered: 0,
    /** @type {Map<string, number>} */
    byComponent: new Map(),
    /** @type {Map<string, Traffic>} */
    rpcIn: new Map(),
    /** @type {Map<string, Traffic>} */
    rpcOut: new Map(),
    /** @type {Map<string, string>} request id to procedure path */
    idToPath: new Map(),
    mutations: 0,
    /** @type {LongFrame[]} */
    loaf: [],
    /** @type {Set<string>} */
    watch: new Set(),
    /** @type {Map<string, Map<string, number>>} */
    why: new Map(),
  };
  const reset = () => {
    state.t0 = performance.now();
    state.commits = 0;
    state.commitMs = 0;
    state.fibersRendered = 0;
    state.byComponent = new Map();
    state.rpcIn = new Map();
    state.rpcOut = new Map();
    state.mutations = 0;
    state.loaf = [];
    state.why = new Map();
  };

  /** @param {Map<string, number>} counts @param {string} key */
  const count = (counts, key) => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  /** @param {Fiber} fiber */
  const nameOf = (fiber) => {
    const { type } = fiber;
    if (!type || typeof type === "string") {
      return "?";
    }
    return (
      type.displayName ||
      type.name ||
      type.render?.displayName ||
      type.render?.name ||
      type.type?.displayName ||
      type.type?.name ||
      "anonymous"
    );
  };

  /** @param {Fiber} fiber @param {Fiber} before */
  const reasonsFor = (fiber, before) => {
    const previous = before.memoizedProps ?? {};
    const next = fiber.memoizedProps ?? {};
    const reasons = Object.keys({ ...previous, ...next })
      .filter((key) => previous[key] !== next[key])
      .map((key) => `prop:${key}`);
    if (fiber.memoizedState !== before.memoizedState) {
      reasons.push("state");
    }
    if (reasons.length === 0) {
      reasons.push(
        fiber.dependencies?.firstContext ? "context-or-forced" : "none-visible",
      );
    }
    return reasons;
  };

  /** @param {{ current: Fiber }} root */
  const walk = (root) => {
    /** @type {Fiber[]} */
    const stack = [root.current];
    for (let fiber = stack.pop(); fiber; fiber = stack.pop()) {
      const before = fiber.alternate;
      const rendered = before === null || (fiber.flags & PERFORMED_WORK) !== 0;
      if (COMPONENT_TAGS.has(fiber.tag) && rendered) {
        state.fibersRendered++;
        const name = nameOf(fiber);
        count(state.byComponent, name);
        if (before && state.watch.has(name)) {
          const counts =
            state.why.get(name) ??
            /** @type {Map<string, number>} */ (new Map());
          for (const reason of reasonsFor(fiber, before)) {
            count(counts, reason);
          }
          state.why.set(name, counts);
        }
      }
      // A subtree React bailed out of keeps last commit's fibers and flags.
      if (fiber.child && (before === null || fiber.child !== before.child)) {
        stack.push(fiber.child);
      }
      if (fiber.sibling) {
        stack.push(fiber.sibling);
      }
    }
  };

  const hookHost = /** @type {Window & Record<string, unknown>} */ (window);
  if (!hookHost.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    /** @type {Map<number, unknown>} */
    const renderers = new Map();
    hookHost.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers,
      supportsFiber: true,
      isDisabled: false,
      /** @param {unknown} renderer */
      inject(renderer) {
        const id = renderers.size + 1;
        renderers.set(id, renderer);
        return id;
      },
      checkDCE() {},
      onScheduleFiberRoot() {},
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      /** @param {number} _id @param {{ current: Fiber }} root */
      onCommitFiberRoot(_id, root) {
        const start = performance.now();
        state.commits++;
        try {
          walk(root);
        } catch {
          // A fiber shape this does not know costs the count, not the app.
        }
        state.commitMs += performance.now() - start;
      },
    };
  }

  /** @param {Map<string, Traffic>} map @param {string} key @param {number} bytes */
  const bump = (map, key, bytes) => {
    const entry = map.get(key) ?? { n: 0, bytes: 0 };
    entry.n++;
    entry.bytes += bytes;
    map.set(key, entry);
  };
  /** oRPC frames are JSON strings opening with the request id. @param {string} data */
  const idOf = (data) => /^\{"i":"?([^",}]+)/.exec(data)?.[1];
  /** @param {unknown} data */
  const sizeOf = (data) =>
    typeof data === "string"
      ? data.length
      : data instanceof ArrayBuffer
        ? data.byteLength
        : 0;
  /** @param {string | undefined} id */
  const pathOf = (id) => (id && state.idToPath.get(id)) ?? "?";

  const originalPost = /** @type {MessagePort["postMessage"]} */ (
    Reflect.get(MessagePort.prototype, "postMessage")
  );
  /** @this {MessagePort} @param {unknown} data @param {...unknown} rest */
  MessagePort.prototype.postMessage = function (data, ...rest) {
    if (typeof data === "string") {
      const id = idOf(data);
      const path = /"u":"([^"]+)"/.exec(data)?.[1];
      if (id && path) {
        state.idToPath.set(id, path.replace(/^orpc:\/+/, "/"));
      }
      bump(state.rpcOut, pathOf(id), sizeOf(data));
    }
    Reflect.apply(originalPost, this, [data, ...rest]);
  };
  /** @param {MessageEvent<unknown>} event */
  const countInbound = (event) => {
    const { data } = event;
    if (typeof data === "string" || data instanceof ArrayBuffer) {
      bump(
        state.rpcIn,
        pathOf(typeof data === "string" ? idOf(data) : undefined),
        sizeOf(data),
      );
    }
  };
  /** @type {WeakSet<MessagePort>} */
  const probed = new WeakSet();
  /** @param {MessagePort} port */
  const listenOnce = (port) => {
    if (!probed.has(port)) {
      probed.add(port);
      originalAdd.call(port, "message", countInbound);
    }
  };
  const originalAdd = /** @type {MessagePort["addEventListener"]} */ (
    Reflect.get(MessagePort.prototype, "addEventListener")
  );
  /**
   * @this {MessagePort}
   * @param {string} type
   * @param {EventListenerOrEventListenerObject} listener
   * @param {boolean | AddEventListenerOptions} [options]
   */
  MessagePort.prototype.addEventListener = function (type, listener, options) {
    if (type === "message") {
      listenOnce(this);
    }
    originalAdd.call(this, type, listener, options);
  };
  const onmessage = Object.getOwnPropertyDescriptor(
    MessagePort.prototype,
    "onmessage",
  );
  Object.defineProperty(MessagePort.prototype, "onmessage", {
    configurable: true,
    /** @this {MessagePort} @returns {unknown} */
    get() {
      return onmessage?.get?.call(this);
    },
    /** @this {MessagePort} @param {unknown} handler */
    set(handler) {
      listenOnce(this);
      onmessage?.set?.call(this, handler);
    },
  });

  new PerformanceObserver((list) => {
    for (const entry of /** @type {LongFrameTiming[]} */ (list.getEntries())) {
      const top = [...entry.scripts].sort((a, b) => b.duration - a.duration)[0];
      state.loaf.push({
        at: Math.round(entry.startTime - state.t0),
        ms: Math.round(entry.duration),
        blocking: Math.round(entry.blockingDuration),
        style: Math.round(
          entry.styleAndLayoutStart
            ? entry.startTime + entry.duration - entry.styleAndLayoutStart
            : 0,
        ),
        top: top
          ? `${Math.round(top.duration)}ms ${top.invoker} ${top.sourceURL.split("/").pop() ?? ""}:${top.sourceFunctionName}`
          : undefined,
      });
    }
  }).observe({ type: "long-animation-frame", buffered: true });

  const startMutations = () => {
    new MutationObserver((records) => {
      state.mutations += records.length;
    }).observe(document.documentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  };
  if (document.documentElement) {
    startMutations();
  } else {
    document.addEventListener("readystatechange", startMutations, {
      once: true,
    });
  }

  /** @param {Map<string, Traffic>} map */
  const totals = (map) =>
    [...map.values()].reduce(
      (sum, entry) => ({ n: sum.n + entry.n, bytes: sum.bytes + entry.bytes }),
      { n: 0, bytes: 0 },
    );
  /** @param {Map<string, Traffic>} map @param {number} limit */
  const table = (map, limit) =>
    [...map.entries()]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .slice(0, limit)
      .map(([path, { n, bytes }]) => ({
        path,
        n,
        kb: Math.round(bytes / 102.4) / 10,
      }));
  /** @param {Map<string, number>} counts @param {number} limit */
  const ranked = (counts, limit) =>
    [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);

  const heap =
    /** @type {Performance & { memory?: { usedJSHeapSize: number } }} */ (
      performance
    );

  hookHost.__perfProbe = {
    reset,
    /** @param {string[]} names */
    watch(names) {
      state.watch = new Set(names);
    },
    snapshot({ components = 15, rpc = 12 } = {}) {
      const inbound = totals(state.rpcIn);
      const { loaf } = state;
      return {
        seconds: Math.round((performance.now() - state.t0) / 100) / 10,
        commits: state.commits,
        fibersRendered: state.fibersRendered,
        probeCommitMs: Math.round(state.commitMs),
        topComponents: ranked(state.byComponent, components).map(
          ([name, n]) => `${n} ${name}`,
        ),
        rpcIn: {
          messages: inbound.n,
          kb: Math.round(inbound.bytes / 1024),
          top: table(state.rpcIn, rpc),
        },
        rpcOut: {
          messages: totals(state.rpcOut).n,
          top: table(state.rpcOut, 6),
        },
        mutations: state.mutations,
        longFrames: {
          count: loaf.length,
          totalMs: loaf.reduce((sum, frame) => sum + frame.ms, 0),
          blockingMs: loaf.reduce((sum, frame) => sum + frame.blocking, 0),
          worst: [...loaf].sort((a, b) => b.ms - a.ms).slice(0, 5),
        },
        why: Object.fromEntries(
          [...state.why].map(([name, counts]) => [
            name,
            Object.fromEntries(ranked(counts, 12)),
          ]),
        ),
        heapMb: Math.round((heap.memory?.usedJSHeapSize ?? 0) / 1048576),
        domNodes: document.getElementsByTagName("*").length,
      };
    },
  };
})();
