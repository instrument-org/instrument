import { type Atom } from "jotai";
import { unwrap } from "jotai/utils";

/**
 * Reads an async atom without suspending. The fallback stands in only until the
 * first value resolves; after that the last resolved value stays on screen
 * while the next one loads, so refetching over a store that holds several
 * unrelated settings does not flash every reader back to the defaults when one
 * of them changes.
 *
 * The source atom is expected to resolve rather than reject: a rejection
 * propagates to whoever reads this atom.
 */
export function atomWithoutSuspense<T>(
  asyncAtom: Atom<Promise<T>>,
  fallback: T,
): Atom<T> {
  return unwrap(asyncAtom, (previous) => previous ?? fallback);
}
