/**
 * Chromium reports "ResizeObserver loop completed with undelivered
 * notifications" when, during a frame's observer step, something changes the
 * size of an observed box no deeper in the document than the shallowest box
 * the pass just delivered, or starts observing one, so its notification waits
 * for the next frame. The error event carries no stack and no element, so a
 * report of it names nothing. This keeps a record of the observer callbacks
 * of the step in progress (where each observer was made, what it saw, the
 * pass of the step that delivered it, and what began to be observed while it
 * ran), which `resizeLoopWitnesses` hands to the report.
 *
 * Watched closely, every observed box is also measured after each callback,
 * so the report names the callback that resized a box the step could no
 * longer deliver: the cause, rather than who was there. Tests watch closely
 * always; the app does for a while after a loop, since a loop tends to come
 * again in the frames that follow.
 */

/** The message Chromium raises the loop with, matched as its start. */
const LOOP_MESSAGE = "ResizeObserver loop";

/** How many callbacks of one step are kept, and how much of each. */
const KEPT_CALLBACKS = 24;
const TARGETS_PER_CALLBACK = 3;
const STACK_FRAMES = 4;

/** How long the app watches closely after a loop. */
const CLOSE_AFTER_LOOP_MS = 10_000;

type Watched = {
  created: string;
  /** Creation order, the order a pass of the step delivers observers in. */
  order: number;
  targets: Set<Element>;
};

type Ran = {
  observer: Watched;
  /** The pass of the step that delivered it, from 1. */
  pass: number;
  /** The shallowest of the boxes it was given. */
  depth: number;
  targets: Element[];
  /** Boxes it began to observe, or observe afresh, while it ran. */
  observed: Element[];
  /** Observed boxes whose size it changed, when watched closely. */
  resized: Element[];
};

/** The observer step of the frame in progress, from its first callback. */
let step: Ran[] | undefined;
let made = 0;
let isAlwaysClose = false;
let closeUntil = 0;
/**
 * Every observer, held weakly: one nothing else holds is gone, along with the
 * boxes it observed.
 */
const observers = new Set<WeakRef<Watched>>();
/** Each observed box's size as last measured while watching closely. */
const sizes = new WeakMap<Element, string>();

/**
 * Wraps the window's `ResizeObserver` so every callback is noted as it runs.
 * `closely` measures every observed box after each callback from the start,
 * which costs a layout read per box per callback.
 */
export function watchResizeObservers(watching?: { closely?: boolean }) {
  const Native = window.ResizeObserver;
  if (!Native) {
    return;
  }
  isAlwaysClose = watching?.closely ?? false;
  window.ResizeObserver = class extends Native {
    #watched: Watched;

    constructor(callback: ResizeObserverCallback) {
      const watched: Watched = {
        created: creationSite(new Error().stack),
        order: made++,
        targets: new Set(),
      };
      super((entries, observer) => {
        const ran = noteRun(watched, entries);
        callback(entries, observer);
        if (ran && isClose()) {
          // After the callback's microtasks, so a commit React flushes there
          // counts as the callback's.
          queueMicrotask(() => {
            ran.resized = remeasure();
          });
        }
      });
      this.#watched = watched;
      observers.add(new WeakRef(watched));
    }

    observe(target: Element, options?: ResizeObserverOptions) {
      step?.at(-1)?.observed.push(target);
      this.#watched.targets.add(target);
      super.observe(target, options);
    }

    unobserve(target: Element) {
      this.#watched.targets.delete(target);
      super.unobserve(target);
    }

    disconnect() {
      this.#watched.targets.clear();
      super.disconnect();
    }
  };
}

function isClose() {
  return isAlwaysClose || performance.now() < closeUntil;
}

function noteRun(
  observer: Watched,
  entries: ResizeObserverEntry[],
): Ran | undefined {
  if (!step) {
    step = [];
    // The next frame's animation callbacks run before its observer step.
    // oxlint-disable-next-line studio/no-loose-timers -- ends the step's record, once a frame, whatever comes after
    requestAnimationFrame(() => {
      step = undefined;
    });
    if (isClose()) {
      remeasure();
    }
  }
  if (step.length >= KEPT_CALLBACKS) {
    return undefined;
  }
  const last = step.at(-1);
  const ran: Ran = {
    depth: Math.min(...entries.map((entry) => depthOf(entry.target))),
    observed: [],
    observer,
    pass:
      last === undefined
        ? 1
        : observer.order <= last.observer.order
          ? last.pass + 1
          : last.pass,
    resized: [],
    targets: entries.map((entry) => entry.target),
  };
  step.push(ran);
  return ran;
}

/** Measures every observed box, answering the ones that changed. */
function remeasure(): Element[] {
  const changed = new Set<Element>();
  for (const ref of observers) {
    const watched = ref.deref();
    if (!watched) {
      observers.delete(ref);
      continue;
    }
    for (const target of watched.targets) {
      if (!target.isConnected) {
        continue;
      }
      const size = sizeOf(target);
      const last = sizes.get(target);
      if (last !== undefined && last !== size) {
        changed.add(target);
      }
      sizes.set(target, size);
    }
  }
  return [...changed];
}

/**
 * A box's border box, padding box and padding, which together change with
 * any of the boxes an observer can watch: under `border-box` sizing, padding
 * alone moves the content box.
 */
function sizeOf(element: Element) {
  const { height, width } = element.getBoundingClientRect();
  return element instanceof HTMLElement
    ? `${width}x${height} ${element.clientWidth}x${element.clientHeight} ${getComputedStyle(element).padding}`
    : `${width}x${height}`;
}

/** Whether a box is past the 0x0 a new observation starts from. */
function hasSize(element: Element) {
  const { height, width } = element.getBoundingClientRect();
  return width > 0 || height > 0;
}

/**
 * For an error event that is the observer loop, one line per callback of the
 * step it ended: the pass that delivered it, what it observed and where the
 * observer was made. Before them, a line for each box the step could not
 * deliver that a callback began observing, or, watched closely, resized.
 * Undefined for any other error. Watches closely for a while after.
 */
export function resizeLoopWitnesses(message: unknown): string[] | undefined {
  if (typeof message !== "string" || !message.startsWith(LOOP_MESSAGE)) {
    return undefined;
  }
  closeUntil = performance.now() + CLOSE_AFTER_LOOP_MS;
  const runs = step ?? [];
  const shallowest = new Map<number, number>();
  for (const ran of runs) {
    shallowest.set(
      ran.pass,
      Math.min(shallowest.get(ran.pass) ?? Infinity, ran.depth),
    );
  }
  /** Whether a box changed in a pass waits for the next frame. */
  const isHeldBack = (ran: Ran, target: Element) =>
    target.isConnected &&
    depthOf(target) <= (shallowest.get(ran.pass) ?? Infinity);
  const causes = runs.flatMap((ran) => [
    ...ran.resized
      .filter((target) => isHeldBack(ran, target))
      .map(
        (target) =>
          `resized ${describeElement(target)} (observed ← ${observersOf(target)}) ← ${ran.observer.created}`,
      ),
    ...ran.observed
      .filter((target) => isHeldBack(ran, target) && hasSize(target))
      .map(
        (target) =>
          `began observing ${describeElement(target)} ← ${ran.observer.created}`,
      ),
  ]);
  return [
    ...causes,
    ...runs.map(
      (ran) =>
        `pass ${ran.pass}: ${ran.targets
          .slice(0, TARGETS_PER_CALLBACK)
          .map(describeElement)
          .join(", ")} ← ${ran.observer.created}`,
    ),
  ];
}

/** Where each observer of a box was made, its first frame alone. */
function observersOf(target: Element) {
  const sites: string[] = [];
  for (const ref of observers) {
    const watched = ref.deref();
    if (watched?.targets.has(target)) {
      sites.push(watched.created.split(" < ")[0] ?? "");
    }
  }
  return sites.join("; ");
}

/** How many nodes are above it, as the observer step counts depth. */
function depthOf(element: Element) {
  let depth = 0;
  for (
    let node: Node | null = element;
    node;
    node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)
  ) {
    depth++;
  }
  return depth;
}

/** The frames that made the observer, the wrapper's own left out. */
function creationSite(stack: string | undefined): string {
  return (stack ?? "")
    .split("\n")
    .slice(2, 2 + STACK_FRAMES)
    .map((line) => line.trim().replace(/^at /, ""))
    .join(" < ");
}

/** An element and its parent as selectors, with no text from the page. */
function describeElement(element: Element): string {
  const parent = element.parentElement;
  return parent
    ? `${selectorOf(parent)} > ${selectorOf(element)}`
    : selectorOf(element);
}

function selectorOf(element: Element): string {
  const slot = element.getAttribute("data-slot");
  const classes = [...element.classList].slice(0, 4).map((name) => `.${name}`);
  return [
    element.tagName.toLowerCase(),
    element.id ? `#${element.id}` : "",
    slot ? `[data-slot=${slot}]` : "",
    ...classes,
  ].join("");
}
