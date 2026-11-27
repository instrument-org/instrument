import {
  createContext,
  use,
  useCallback,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * What the reader opened or closed in a transcript's turns, or turned on or
 * off (a code block's line wrapping), one entry per control, kept above the
 * turns: a turn far from view is drawn as a box (`FarRows`), which unmounts
 * what it had, and drawn again shows as the reader left it.
 */
export class KeptOpen {
  private readonly open = new Map<string, boolean>();
  private readonly listeners = new Map<string, Set<() => void>>();

  get(key: string): boolean | undefined {
    return this.open.get(key);
  }

  set(key: string, isOpen: boolean) {
    if (this.open.get(key) === isOpen) {
      return;
    }
    this.open.set(key, isOpen);
    for (const listener of this.listeners.get(key) ?? []) {
      listener();
    }
  }

  subscribe(key: string, listener: () => void): () => void {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(key);
      }
    };
  }
}

/** The transcript's, given by `Transcript`; none anywhere else. */
export const KeptOpenContext = createContext<KeptOpen | null>(null);

/** The turn a control is in, which its key is taken within. */
export const KeptOpenTurn = createContext("");

/**
 * Whether a control in a turn is open (or on), as the reader chose
 * (`undefined` until they do), kept by the transcript under `key` within its
 * turn. Outside a transcript it is the control's own state.
 */
export function useKeptOpen(
  key: string,
): [boolean | undefined, (isOpen: boolean) => void] {
  const kept = use(KeptOpenContext);
  const turn = use(KeptOpenTurn);
  const [own, setOwn] = useState<boolean>();
  const id = `${turn}:${key}`;
  const subscribe = useCallback(
    (listener: () => void) =>
      kept ? kept.subscribe(id, listener) : () => undefined,
    [id, kept],
  );
  const stored = useSyncExternalStore(subscribe, () => kept?.get(id));
  const setStored = useCallback(
    (isOpen: boolean) => {
      kept?.set(id, isOpen);
    },
    [id, kept],
  );
  return kept ? [stored, setStored] : [own, setOwn];
}
