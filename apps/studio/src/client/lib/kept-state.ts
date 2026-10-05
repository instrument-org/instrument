import { type KeptFile } from "@/shared/kept-state";
import { atomWithStorage } from "jotai/utils";

/**
 * What the windows keep across launches, as this window holds it: read from
 * the preload once, written through to the main process (which owns the
 * files, see `stores/workspace/kept-state.ts`), and kept up with what other
 * windows write. Outside Electron (tests) it is memory alone.
 */
let values: Map<string, unknown> | null = null;

const listeners = new Set<
  (file: KeptFile, key: string, value: unknown) => void
>();

/** The preload's side of the kept state, where there is one. */
function bridge() {
  return globalThis.window === undefined ? undefined : window.api?.keptState;
}

/** Where a value is held in this window: its file and key together. */
const slotOf = (file: KeptFile, key: string) => `${file}/${key}`;

function kept(): Map<string, unknown> {
  if (values) {
    return values;
  }
  values = new Map(
    Object.entries(bridge()?.initial ?? {}).flatMap(([file, keys]) =>
      Object.entries(keys).map(([key, value]) => [`${file}/${key}`, value]),
    ),
  );
  bridge()?.onChange((file, key, value) => {
    remember(file, key, value);
    for (const listener of listeners) {
      listener(file, key, value);
    }
  });
  return values;
}

function remember(file: KeptFile, key: string, value: unknown) {
  if (value === undefined) {
    kept().delete(slotOf(file, key));
  } else {
    kept().set(slotOf(file, key), value);
  }
}

/** Whether a file holds a value under a key. */
export function hasKept(file: KeptFile, key: string): boolean {
  return kept().has(slotOf(file, key));
}

/** Keeps a value under a key of a file, here and on disk; `undefined` removes it. */
export function writeKept(file: KeptFile, key: string, value: unknown) {
  remember(file, key, value);
  bridge()?.set(file, key, value);
}

/**
 * Whether a kept value is the same kind of thing as the default: a number
 * for a number, an array for an array, and so on. A key's version guards
 * what its value means; this guards against a value of another shape
 * entirely (a file edited by hand, a key reused), which would otherwise
 * reach code that maps over it.
 */
function isLike<T>(value: unknown, initial: T): value is T {
  if (initial === null) {
    return value === null || typeof value === "string";
  }
  if (Array.isArray(initial)) {
    return Array.isArray(value);
  }
  return (
    typeof value === typeof initial && value !== null && !Array.isArray(value)
  );
}

/**
 * A value the windows keep across launches, under `key` in one of the kept
 * files, read before the first render. The key carries a version (`.v1`),
 * bumped when what the value means changes so an old one is ignored rather
 * than misread. `read` makes what was kept into what this build uses, for a
 * value that needs more than a check of its kind; it returns the default for
 * anything it cannot use.
 */
export function keptAtom<T>(
  file: KeptFile,
  key: string,
  initial: T,
  read?: (value: unknown, initial: T) => T,
) {
  const parse = (value: unknown): T => {
    if (value === undefined) {
      return initial;
    }
    if (read) {
      return read(value, initial);
    }
    return isLike(value, initial) ? value : initial;
  };
  return atomWithStorage<T>(
    key,
    initial,
    {
      getItem: () => parse(kept().get(slotOf(file, key))),
      removeItem: () => {
        writeKept(file, key, undefined);
      },
      setItem: (_, value) => {
        writeKept(file, key, value);
      },
      subscribe: (_, callback) => {
        const listener = (
          changedFile: KeptFile,
          changedKey: string,
          value: unknown,
        ) => {
          if (changedFile === file && changedKey === key) {
            callback(parse(value));
          }
        };
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    { getOnInit: true },
  );
}

/** Forgets everything kept, for tests, which share one module between them. */
export function clearKeptState() {
  values = new Map();
}
