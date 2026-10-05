import { isKeptKey, KEPT_STATE_FILES, type KeptKey } from "@/shared/kept-state";
import { atomWithStorage } from "jotai/utils";

/**
 * What the windows keep across launches, as this window holds it: read from
 * the preload once, written through to the main process (which owns the
 * files, see `stores/workspace/kept-state.ts`), and kept up with what other
 * windows write. Outside Electron (tests) it is memory alone.
 */
let values: Map<string, unknown> | null = null;

const listeners = new Set<(key: string, value: unknown) => void>();

/** The preload's side of the kept state, where there is one. */
function bridge() {
  return globalThis.window === undefined ? undefined : window.api?.keptState;
}

function kept(): Map<string, unknown> {
  if (values) {
    return values;
  }
  values = new Map(Object.entries(bridge()?.initial ?? {}));
  bridge()?.onChange((key, value) => {
    if (value === undefined) {
      values?.delete(key);
    } else {
      values?.set(key, value);
    }
    for (const listener of listeners) {
      listener(key, value);
    }
  });
  return values;
}

function write(key: KeptKey, value: unknown) {
  if (value === undefined) {
    kept().delete(key);
  } else {
    kept().set(key, value);
  }
  bridge()?.set(key, value);
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
 * A value the windows keep across launches, read before the first render.
 * `read` makes what was kept into what this build uses, for a value that
 * needs more than a check of its kind; it gets the default back for anything
 * it cannot use.
 */
export function keptAtom<T>(
  key: KeptKey,
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
      getItem: (name) => parse(kept().get(name)),
      removeItem: (name) => {
        if (isKeptKey(name)) {
          write(name, undefined);
        }
      },
      setItem: (name, value) => {
        if (isKeptKey(name)) {
          write(name, value);
        }
      },
      subscribe: (name, callback) => {
        const listener = (changed: string, value: unknown) => {
          if (changed === name) {
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

/**
 * Moves what earlier builds kept in this window's localStorage (each key
 * under `studio.` and the same name) into the kept state, once: a key the
 * kept state already has keeps its value, and the old key goes either way.
 * Runs before anything reads a kept atom.
 */
export function importLocalStorage(
  storage: Pick<Storage, "getItem" | "removeItem">,
) {
  for (const key of Object.keys(KEPT_STATE_FILES)) {
    if (!isKeptKey(key)) {
      continue;
    }
    const legacy = `studio.${key}`;
    const raw = storage.getItem(legacy);
    if (raw === null) {
      continue;
    }
    if (!kept().has(key)) {
      try {
        const value: unknown = JSON.parse(raw);
        write(key, value);
      } catch {
        // Not JSON: nothing to bring over.
      }
    }
    storage.removeItem(legacy);
  }
}

/** Forgets everything kept, for tests, which share one module between them. */
export function clearKeptState() {
  values = new Map();
}
