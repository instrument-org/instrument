/**
 * Split a character budget across competing pieces of text.
 *
 * The obvious alternative -- fill from the start until the budget runs out --
 * rewards whichever piece happens to come first and leaves the last ones with
 * nothing. That is the wrong answer for both callers here: the last of six
 * search excerpts is as likely to hold the passage that answers the query as
 * the first, and the last of five tool results in one step is as likely to be
 * the one the model was waiting on.
 *
 * So capacity is shared max-min: everything short enough to fit an equal share
 * is kept whole, and what it did not use is handed back to the pieces that are
 * still too long, repeatedly, until only pieces above the current share remain.
 * They split what is left evenly. One enormous result therefore cannot erase
 * the others, and a batch of small ones is not clipped for no reason.
 *
 * Returns how many characters each piece may keep, in the order it was given.
 * The total never exceeds `budget`, and no allowance exceeds the length it was
 * computed for, so an allowance equal to its length means "keep this whole".
 */
export function allocateFairShare(
  lengths: readonly number[],
  budget: number,
): number[] {
  const allowances = Array.from<number>({ length: lengths.length }).fill(0);
  if (budget <= 0) {
    return allowances;
  }

  let pending = lengths.map((_, index) => index);
  let remaining = budget;

  while (pending.length > 0) {
    const share = Math.floor(remaining / pending.length);
    const fitting = pending.filter((index) => (lengths[index] ?? 0) <= share);

    if (fitting.length === 0) {
      // Everything left is longer than an equal share, so an equal share is
      // what each gets. The leftover characters go to the earliest pieces
      // rather than being dropped, which keeps the total exactly on budget.
      let extra = remaining - share * pending.length;
      for (const index of pending) {
        allowances[index] = share + (extra > 0 ? 1 : 0);
        extra -= 1;
      }
      return allowances;
    }

    for (const index of fitting) {
      const length = lengths[index] ?? 0;
      allowances[index] = length;
      remaining -= length;
    }
    pending = pending.filter((index) => (lengths[index] ?? 0) > share);
  }

  return allowances;
}
