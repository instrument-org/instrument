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

/** Keeps a value under a key of a file, here and on disk; `undefined` removes it. */
export function writeKept(file: KeptFile, key: string, value: unknown) {
  remember(file, key, value);
  bridge()?.set(file, key, value);
}

/** One key of `window` as every other window kept it, closed ones that can come back included. */
export function keptInOtherWindows(key: string): unknown[] {
  return bridge()?.otherWindows(key) ?? [];
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

/** A value kept and taken back out, for what an earlier build kept under another key. */
export function takeKept(file: KeptFile, key: string): unknown {
  const value = kept().get(slotOf(file, key));
  if (value !== undefined) {
    writeKept(file, key, undefined);
  }
  return value;
}

/**
 * A value kept member by member, each under a key of its own, in the file
 * `fileOf` names for it. A window writes only the members it changed, so two
 * windows changing different ones at once never undo each other, as whole
 * writes crossing on their way through the main process would.
 */
export function keptMembersAtom<T>(
  fileOf: (member: string) => KeptFile,
  key: string,
  {
    join,
    split,
  }: {
    join: (members: Map<string, unknown>) => T;
    split: (value: T) => Map<string, unknown>;
  },
) {
  const prefix = `${key}/`;
  const memberOf = (slot: string) => {
    const at = slot.indexOf(`/${prefix}`);
    const member = at === -1 ? "" : slot.slice(at + 1 + prefix.length);
    return member !== "" && slot === slotOf(fileOf(member), prefix + member)
      ? [member]
      : [];
  };
  const memberKeys = () => [...kept().keys()].flatMap(memberOf);
  const read = (): T =>
    join(
      new Map(
        memberKeys().map((member) => [
          member,
          kept().get(slotOf(fileOf(member), prefix + member)),
        ]),
      ),
    );
  return atomWithStorage<T>(
    key,
    join(new Map()),
    {
      getItem: read,
      removeItem: () => {
        for (const member of memberKeys()) {
          writeKept(fileOf(member), prefix + member, undefined);
        }
      },
      setItem: (_, value) => {
        const members = split(value);
        for (const member of memberKeys()) {
          if (!members.has(member)) {
            writeKept(fileOf(member), prefix + member, undefined);
          }
        }
        for (const [member, entry] of members) {
          const file = fileOf(member);
          const before = kept().get(slotOf(file, prefix + member));
          if (JSON.stringify(before) !== JSON.stringify(entry)) {
            writeKept(file, prefix + member, entry);
          }
        }
      },
      subscribe: (_, callback) => {
        const listener = (_file: KeptFile, changedKey: string) => {
          if (changedKey.startsWith(prefix)) {
            callback(read());
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
