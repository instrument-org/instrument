import { useInsertionEffect, useRef, useState } from "react";

type Callbacks = Record<string, ((...args: never[]) => unknown) | undefined>;

/**
 * The callbacks a caller handed in, each as one function for the life of the
 * component, calling whichever the caller handed in last. A component that
 * builds its own handlers from a caller's keeps them, and every memoized row
 * under it, from changing each time the caller renders a new closure.
 *
 * Only for callbacks run from events and effects: one called while rendering
 * would draw from the render before. One left out (`undefined`) stays left
 * out, so a check for whether the caller handed one in still reads true.
 */
export function useSteadyCallbacks<T extends Callbacks>(callbacks: T): T {
  // Reads its ref while rendering on purpose: the functions it hands out are
  // made once and read the ref only when called.
  "use no memo";
  const latest = useRef(callbacks);
  // Before any layout effect, a child's included, can call one.
  useInsertionEffect(() => {
    latest.current = callbacks;
  });
  const handedIn = Object.keys(callbacks)
    .filter((name) => callbacks[name] !== undefined)
    .join(",");
  // oxlint-disable-next-line react/refs -- the ref is read only when one is called
  const [steady, setSteady] = useState(() => steadyOf(latest, handedIn));
  if (steady.handedIn !== handedIn) {
    // oxlint-disable-next-line react/refs -- as above
    setSteady(steadyOf(latest, handedIn));
  }
  return steady.callbacks;
}

function steadyOf<T extends Callbacks>(
  latest: { readonly current: T },
  handedIn: string,
) {
  const names = handedIn === "" ? [] : handedIn.split(",");
  return {
    // The same names as the caller's, each a function of the same shape.
    callbacks: Object.fromEntries(
      names.map((name) => [
        name,
        (...args: never[]) => latest.current[name]?.(...args),
      ]),
    ) as T,
    handedIn,
  };
}
