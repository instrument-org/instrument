import { toast } from "@/client/lib/toast";

/**
 * The toast offering Undo for each journal entry it would take back. An undo
 * by any route (the toast's own button, ⌘Z in any Files tab) withdraws that
 * entry from its toast, and the toast goes once nothing on it is left to
 * undo, so no Undo is left on screen for something already put back.
 */
const offers = new Map<string, number | string>();

/**
 * Raises a toast saying `message`, with an Undo that runs `offer.undo` when
 * there is an offer, held until the toast goes or each of its entries is
 * undone another way.
 */
export function toastWithUndo(
  message: string,
  offer: null | { journalIds: readonly string[]; undo: () => void },
  { description }: { description?: string } = {},
) {
  const toastId = toast(message, {
    description,
    action:
      offer === null
        ? undefined
        : {
            label: "Undo",
            onClick: () => {
              // Sonner takes the toast away without calling `onDismiss`, and
              // an undo that stops partway would leave the rest held.
              dropUndoOffer(toastId);
              offer.undo();
            },
          },
    onAutoClose: ({ id }) => {
      dropUndoOffer(id);
    },
    onDismiss: ({ id }) => {
      dropUndoOffer(id);
    },
  });
  if (offer !== null) {
    holdUndoOffer(toastId, offer.journalIds);
  }
}

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

/**
 * Withdraws the offer to undo `journalId`, which has just been undone, and
 * takes its toast down once the toast offers nothing else.
 */
export function withdrawUndoOffer(journalId: string) {
  const toastId = offers.get(journalId);
  if (toastId === undefined) {
    return;
  }
  offers.delete(journalId);
  if (![...offers.values()].includes(toastId)) {
    toast.dismiss(toastId);
  }
}
