/**
 * Counts what React renders, for the tests that hold the window's render work
 * down (`*-renders.browser.test.tsx`): commits, and the components that ran
 * their render, by name. The count is the studio-drive probe's
 * (`.agents/skills/studio-chrome-devtools/scripts/perf-probe-page.js`), so a
 * number here and one from the running app mean the same thing.
 *
 * It stands in for the React DevTools hook, which React reads once, as
 * `react-dom` loads: a test file imports this ahead of everything else, and
 * `renderAppWindow` refuses to count when React did not find it.
 */

/** The part of a React fiber this reads. React does not export the type. */
type Fiber = {
  alternate: Fiber | null;
  child: Fiber | null;
  flags: number;
  sibling: Fiber | null;
  tag: number;
  type: unknown;
};

/** React's PerformedWork flag: the fiber ran its render this commit. */
const PERFORMED_WORK = 1;
/** Function, class, forwardRef, memo and simple memo components. */
const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);

let commits = 0;
let fibers = 0;
let lastCommitAt = 0;
let byComponent = new Map<string, number>();
let lastRoot: undefined | { current: Fiber };
const renderers = new Map<number, unknown>();

function nameOf(fiber: Fiber): string {
  const type = fiber.type as
    | null
    | string
    | {
        displayName?: string;
        name?: string;
        render?: { displayName?: string; name?: string };
        type?: { displayName?: string; name?: string };
      };
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
}

/** Each component fiber under the root. */
function walk(root: { current: Fiber }, visit: (fiber: Fiber) => void) {
  const stack = [root.current];
  for (let fiber = stack.pop(); fiber; fiber = stack.pop()) {
    if (COMPONENT_TAGS.has(fiber.tag)) {
      visit(fiber);
    }
    if (fiber.child) {
      stack.push(fiber.child);
    }
    if (fiber.sibling) {
      stack.push(fiber.sibling);
    }
  }
}

function countRendered(root: { current: Fiber }) {
  const stack = [root.current];
  for (let fiber = stack.pop(); fiber; fiber = stack.pop()) {
    const before = fiber.alternate;
    const rendered = before === null || (fiber.flags & PERFORMED_WORK) !== 0;
    if (COMPONENT_TAGS.has(fiber.tag) && rendered) {
      fibers++;
      const name = nameOf(fiber);
      byComponent.set(name, (byComponent.get(name) ?? 0) + 1);
    }
    // A subtree React bailed out of keeps last commit's fibers and flags.
    if (fiber.child && (before === null || fiber.child !== before.child)) {
      stack.push(fiber.child);
    }
    if (fiber.sibling) {
      stack.push(fiber.sibling);
    }
  }
}

const host = globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown };
host.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  checkDCE() {},
  inject(renderer: unknown) {
    const id = renderers.size + 1;
    renderers.set(id, renderer);
    return id;
  },
  isDisabled: false,
  onCommitFiberRoot(_id: number, root: { current: Fiber }) {
    commits++;
    lastCommitAt = performance.now();
    lastRoot = root;
    countRendered(root);
  },
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {},
  onScheduleFiberRoot() {},
  renderers,
  supportsFiber: true,
};

/** Whether React found the hook, which it does only if this loaded first. */
export function isCounting() {
  return renderers.size > 0;
}

/** What rendered over some stretch: commits, and component renders by name. */
export type Renders = {
  byComponent: ReadonlyMap<string, number>;
  commits: number;
  fibers: number;
};

/** How many components the last root committed has mounted. */
export function mountedComponents() {
  let count = 0;
  if (lastRoot) {
    walk(lastRoot, () => {
      count++;
    });
  }
  return count;
}

/** The components that rendered most, for a failure's message. */
export function topComponents(renders: Renders, count = 12) {
  return [...renders.byComponent]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([name, times]) => `${name} ${times}`)
    .join(", ");
}

/** The components that rendered more times in `after` than in `before`, most first, for a failure's message. */
export function grown(before: Renders, after: Renders) {
  return [...after.byComponent]
    .map(
      ([name, times]) =>
        [name, times - (before.byComponent.get(name) ?? 0)] as const,
    )
    .filter(([, more]) => more > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, more]) => `${name} +${more}`)
    .join(", ");
}

/**
 * Waits until nothing has committed for `quietMs`, so a count covers the
 * whole of what an action set off: its commit, the effects that answer it,
 * and any timer shorter than the wait. Fails past `timeoutMs`, which only a
 * render loop reaches, naming what rendered while it waited.
 */
export async function settled({
  quietMs = 150,
  timeoutMs = 10_000,
}: { quietMs?: number; timeoutMs?: number } = {}) {
  const start = performance.now();
  const before: Renders = { byComponent: new Map(byComponent), commits, fibers };
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const now = performance.now();
    if (now - Math.max(lastCommitAt, start) >= quietMs) {
      return;
    }
    if (now - start > timeoutMs) {
      const during: Renders = { byComponent, commits, fibers };
      throw new Error(
        `React was still committing ${timeoutMs} ms on, a render loop. What rendered while waiting: ${grown(before, during)}.`,
      );
    }
  }
}

/**
 * What `action` renders, from a window quiet for `quietBeforeMs` until it is
 * quiet for `quietMs` again. A wait before as long as the one after keeps
 * the last action's timers out of this one's count.
 */
export async function rendersOf(
  action: () => unknown,
  { quietBeforeMs, quietMs }: { quietBeforeMs?: number; quietMs?: number } = {},
): Promise<Renders> {
  await settled(quietBeforeMs === undefined ? {} : { quietMs: quietBeforeMs });
  commits = 0;
  fibers = 0;
  byComponent = new Map();
  await action();
  await settled(quietMs === undefined ? {} : { quietMs });
  return { byComponent, commits, fibers };
}
