import { useEffect, useState } from "react";

/** A running clock: `0:08`, `1:22`, `1:02:05`. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours.toString()}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes.toString()}:${seconds}`;
}

/** How long something has gone, in words: `12s`, `1 min 12s`, `1 hr 4 min`. */
export function formatSpan(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours.toString()} hr ${minutes.toString()} min`;
  }
  return minutes > 0
    ? `${minutes.toString()} min ${seconds.toString()}s`
    : `${seconds.toString()}s`;
}

/** The same to the minute once it has reached one: `12s`, `3 min`, `1 hr 4 min`. */
export function formatRoughSpan(ms: number): string {
  return formatSpan(ms).replace(/ min \d+s$/, " min");
}

/** The time now, ticking once a second while `active`. */
export function useTicking(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    setNow(Date.now());
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [active]);
  return now;
}

/** Whether `at` (in ms) has passed, turning true when it does. */
export function usePassed(at: number | undefined): boolean {
  const [passed, setPassed] = useState(
    () => at !== undefined && Date.now() >= at,
  );
  useEffect(() => {
    if (at === undefined) {
      setPassed(false);
      return;
    }
    const wait = at - Date.now();
    if (wait <= 0) {
      setPassed(true);
      return;
    }
    setPassed(false);
    const timeout = window.setTimeout(() => {
      setPassed(true);
    }, wait);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [at]);
  return passed;
}
