import { useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query and return whether it currently matches.
 * Uses `useSyncExternalStore` so the value is read during render with no effect.
 */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => {
        list.removeEventListener("change", onChange);
      };
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
