import { atom, getDefaultStore, type WritableAtom } from "jotai";

// The single app-wide modal slot: which studio modal is open (identified by
// the symbol its atom closed over), that modal's state, and whether another
// modal is allowed to replace it.
const openModalAtom = atom<null | {
  id: symbol;
  replaceable: boolean;
  state: unknown;
}>(null);

/**
 * Whether any app-wide studio modal holds the slot. Read by hosts of a
 * body-mounted browser guest, which is not inside the dialog's subtree and so
 * would otherwise keep painting straight through its overlay (see
 * use-guest-covered).
 */
export const isStudioModalOpenAtom = atom((get) => get(openModalAtom) !== null);

type StudioModalAtom<T> = WritableAtom<null | T, [null | T], void>;

/**
 * Closes whichever studio modal holds the slot, on the default store the app
 * (and every `openX()` setter) actually uses. For tests: the slot itself is
 * private, so a test that opened a modal has no other way to put it back, and
 * the default store outlives any one of them.
 */
export function resetStudioModals() {
  getDefaultStore().set(openModalAtom, null);
}

/**
 * Creates the atom behind one app-wide studio modal. Every atom made here is
 * a view over the same underlying slot, so at most one studio modal is ever
 * open: opening one (writing a state) claims the slot and thereby closes
 * whichever modal held it — replace, never stack. Writing the state of a
 * modal that is already open just updates it in place.
 *
 * Writing `null` releases the slot only if this modal still owns it. That
 * matters when modal A is replaced by modal B: A's dialog closes and its
 * `onOpenChange(false)` writes `null`, which must not tear down B.
 *
 * Pass `replaceable: false` for a modal that must hold the slot until it
 * closes itself (e.g. the onboarding welcome gate): opening another modal over
 * it is ignored, so its non-dismissible contract holds however that other
 * modal is triggered (menu, command palette, programmatic).
 */
export function studioModalAtom<T>({
  replaceable,
}: { replaceable?: boolean } = {}): StudioModalAtom<T> {
  const id = Symbol();
  const isReplaceable = replaceable ?? true;
  return atom(
    (get) => {
      const open = get(openModalAtom);
      // The slot holds every modal's state as `unknown`; matching `id` proves
      // this one was written as `T`.
      return open?.id === id ? (open.state as T) : null;
    },
    (get, set, state: null | T) => {
      if (state !== null) {
        const open = get(openModalAtom);
        if (open && open.id !== id && !open.replaceable) {
          return;
        }
        set(openModalAtom, { id, replaceable: isReplaceable, state });
      } else if (get(openModalAtom)?.id === id) {
        set(openModalAtom, null);
      }
    },
  );
}
