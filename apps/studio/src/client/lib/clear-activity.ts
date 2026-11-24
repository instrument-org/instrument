import { TIME_RANGES, type TimeRangeId } from "./browsing-data";

/** The detail line under what can be cleared: how many things in the range. */
export function thingsDetail(count: number): string {
  if (count === 0) {
    return "Nothing";
  }
  return `${count} ${count === 1 ? "thing" : "things"}`;
}

/** The toast after clearing, by what was picked and from when. */
export function activityClearedMessage({
  changes,
  opened,
  range,
  requests,
}: {
  changes: boolean;
  opened: boolean;
  range: TimeRangeId;
  requests: boolean;
}): string {
  const what = new Intl.ListFormat("en", { type: "conjunction" }).format([
    ...(opened ? ["files and chats you opened"] : []),
    ...(changes ? ["changes you made"] : []),
    ...(requests ? ["AI usage"] : []),
  ]);
  const phrase =
    TIME_RANGES.find((option) => option.id === range)?.phrase ?? null;
  return `Cleared ${what}${phrase ? ` ${phrase}` : ""}.`;
}
