import { useInsertionEffect, useRef } from "react";

/**
 * A ref to the value as of the last render, for a handler or a listener made
 * once that reads it when called. Set before any layout effect, a child's
 * included, as `useSteadyCallbacks` sets its callbacks.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const latest = useRef(value);
  useInsertionEffect(() => {
    latest.current = value;
  });
  return latest;
}
