import { z } from "zod";

import { foldWords } from "./name-match";

/**
 * What the person picked for what they typed, so the same letters bring the
 * same result to the top next time. A plain list, oldest first, that the
 * caller keeps wherever it keeps things.
 */
export const pickLogSchema = z.array(
  z.object({
    /** When it was picked, in milliseconds. */
    at: z.number(),
    /** The id of what was picked. */
    picked: z.string(),
    /** What was typed, folded, with one space between words. */
    typed: z.string(),
  }),
);

export type PickLog = z.output<typeof pickLogSchema>;

const MOST_PICKS = 500;
const PICK_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The id of what the person picked the last time they typed these letters,
 * or letters these go on from: a pick for exactly these words first, then the
 * newest. Picks older than 30 days are ignored.
 */
export function rememberedPick(
  log: PickLog,
  typed: string,
  now: number,
): string | undefined {
  const text = foldWords(typed).text;
  if (text === "") {
    return undefined;
  }
  let best: PickLog[number] | undefined;
  for (const pick of log) {
    if (
      pick.typed === "" ||
      now - pick.at > PICK_LIFETIME_MS ||
      !text.startsWith(pick.typed)
    ) {
      continue;
    }
    const isExact = pick.typed === text;
    const bestIsExact = best?.typed === text;
    if (
      !best ||
      (isExact && !bestIsExact) ||
      (isExact === bestIsExact && pick.at >= best.at)
    ) {
      best = pick;
    }
  }
  return best?.picked;
}

/**
 * The log with a pick added. One pick is kept per typed text, picks past
 * their 30 days go, and past 500 the oldest go.
 */
export function addPick(
  log: PickLog,
  pick: { at: number; picked: string; typed: string },
): PickLog {
  const typed = foldWords(pick.typed).text;
  if (typed === "") {
    return log;
  }
  return [
    ...log.filter(
      (kept) => kept.typed !== typed && pick.at - kept.at <= PICK_LIFETIME_MS,
    ),
    { at: pick.at, picked: pick.picked, typed },
  ].slice(-MOST_PICKS);
}
