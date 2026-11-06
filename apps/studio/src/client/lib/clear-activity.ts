import { TIME_RANGES, type TimeRangeId } from "./browsing-data";

/** The detail line under "What you did in Instrument": how many things in the range. */
export function thingsDetail(count: number): string {
  if (count === 0) {
    return "Nothing";
  }
  return `${count} ${count === 1 ? "thing" : "things"}`;
}

/** The detail line under "AI requests": how many this computer made in the range. */
export function requestsDetail(count: number): string {
  if (count === 0) {
    return "Nothing";
  }
  return `${count} ${count === 1 ? "request" : "requests"} made on this computer`;
}

/** The toast after clearing, by what was picked and from when. */
export function activityClearedMessage({
  actions,
  range,
  requests,
}: {
  actions: boolean;
  range: TimeRangeId;
  requests: boolean;
}): string {
  const what =
    actions && requests
      ? "your activity and AI requests"
      : actions
        ? "your activity"
        : "your AI requests";
  const phrase =
    TIME_RANGES.find((option) => option.id === range)?.phrase ?? null;
  return phrase ? `Cleared ${what} ${phrase}.` : `Cleared all ${what}.`;
}
