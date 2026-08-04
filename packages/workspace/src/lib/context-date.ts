import { format } from "date-fns";

/**
 * A local calendar date as the session's persisted context records it.
 *
 * Kept apart from the display form because it is what a later turn compares
 * against to decide whether the date has rolled over, and because it is stored:
 * a fixed `yyyy-MM-dd` survives a change to how the date is worded.
 */
export function contextDateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

/** The same date as the model reads it, in system information or a correction. */
export function formatContextDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  // Local midnight, not `new Date(dateKey)`: that parses as UTC and lands on the
  // previous day for anyone west of it.
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  });
}
