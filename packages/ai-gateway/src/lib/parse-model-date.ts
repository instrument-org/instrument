import { isValid, parseISO } from "date-fns";

/**
 * Above this, a number is milliseconds since the epoch rather than seconds.
 *
 * A model list means seconds, which is what OpenRouter, OpenAI and Cloudflare
 * all send, but a list can carry milliseconds for an entry it synthesizes.
 * Read as seconds those land tens of thousands of years out -- a date
 * JavaScript holds quite happily, so nothing throws and the only sign of it is
 * a year six digits wide. The floor is seconds past the year 5138, which no
 * model's release date is and every millisecond timestamp since 1973 is.
 */
const MILLISECONDS_FLOOR = 1e11;

/**
 * The date a provider's list gives for a model, as a calendar date in UTC, or
 * undefined when the list gives none or gives one that does not parse.
 */
export function modelReleaseDate(
  date: number | string | undefined,
): string | undefined {
  const parsed = parseModelDate(date);
  if (parsed.getTime() === 0) {
    return undefined;
  }
  const iso = parsed.toISOString();
  // A year outside four digits is written signed and six wide, so the first ten
  // characters of it are not the calendar date they are for every other year.
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : undefined;
}

export function parseModelDate(date: number | string | undefined): Date {
  if (!date) {
    return new Date(0);
  }
  const parsed =
    typeof date === "string"
      ? parseISO(date)
      : new Date(date < MILLISECONDS_FLOOR ? date * 1000 : date);
  return isValid(parsed) ? parsed : new Date(0);
}
