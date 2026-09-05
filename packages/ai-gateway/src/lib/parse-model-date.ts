import { isValid, parseISO } from "date-fns";

/**
 * The date a provider's list gives for a model, as a calendar date in UTC, or
 * undefined when the list gives none or gives one that does not parse.
 */
export function modelReleaseDate(
  date: number | string | undefined,
): string | undefined {
  const parsed = parseModelDate(date);
  return parsed.getTime() === 0 ? undefined : parsed.toISOString().slice(0, 10);
}

export function parseModelDate(date: number | string | undefined): Date {
  if (!date) {
    return new Date(0);
  }
  const parsed =
    typeof date === "string" ? parseISO(date) : new Date(date * 1000);
  return isValid(parsed) ? parsed : new Date(0);
}
