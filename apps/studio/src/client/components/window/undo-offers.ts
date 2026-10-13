import { toast } from "@/client/lib/toast";

/**
 * The toast offering Undo for each journal entry it would take back. An undo
 * by any route (the toast's own button, ⌘Z in any Files tab) takes that toast
 * down, so no Undo is left on screen for something already put back.
 */
const offers = new Map<string, number | string>();

/** Keeps the toast that offers to undo `journalIds`, until it goes or one of them is undone. */
export function holdUndoOffer(
  toastId: number | string,
  journalIds: readonly string[],
) {
  for (const journalId of journalIds) {
    offers.set(journalId, toastId);
  }
}

/** Forgets a toast's offer once the toast has gone. */
export function dropUndoOffer(toastId: number | string) {
  for (const [journalId, heldBy] of offers) {
    if (heldBy === toastId) {
      offers.delete(journalId);
    }
  }
}

/** Takes down the toast offering to undo `journalId`, which has just been undone. */
export function withdrawUndoOffer(journalId: string) {
  const toastId = offers.get(journalId);
  if (toastId === undefined) {
    return;
  }
  dropUndoOffer(toastId);
  toast.dismiss(toastId);
}
