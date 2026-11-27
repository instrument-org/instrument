import { useEffect, useState } from "react";

/**
 * The value as it stood once it held still for `delayMs`; `initial` until
 * then, the value itself unless given.
 */
export function useDebouncedValue<T>(
  value: T,
  delayMs: number,
  initial: T = value,
): T {
  const [settled, setSettled] = useState(initial);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);
  return settled;
}
