/**
 * When something happened, as a person reads it in a file they opened:
 * local time, no `T`, no `Z`, no milliseconds, so the number matches the
 * clock they were looking at when it happened.
 *
 * One spelling in every file a person opens -- `CHAT.md`, `DRAFT.md`,
 * `TOPIC.md`, a memory -- so a date means the same thing wherever they read
 * one. The record logs keep full precision, since nobody reads one by hand
 * and a log's job is to be exact.
 *
 * `timeZone` is for a file whose other dates are written in a zone of its
 * own, so one file never mixes two clocks. Without it, this computer's.
 */
export function localStamp(at: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
    year: "numeric",
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${read("year")}-${read("month")}-${read("day")} ${read("hour")}:${read("minute")}:${read("second")}`;
}
