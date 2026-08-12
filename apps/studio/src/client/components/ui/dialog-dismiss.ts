/**
 * Keeps a dialog open when the interaction that looked "outside" started inside
 * the toaster.
 *
 * Toasts render outside the dialog's DOM, so Radix counts a click on one as an
 * outside interaction and dismisses. That is wrong wherever a dialog raises its
 * own toast: the action on it (a Reveal in Finder, an undo) is the next thing
 * the user means to do, and taking the dialog away is the one response that
 * cannot be what they wanted. Applied by `DialogContent`, and
 * separately by the surfaces built on the Radix primitives directly.
 */
export function keepOpenForToasts(event: {
  detail: { originalEvent: { target: EventTarget | null } };
  preventDefault: () => void;
}) {
  const target = event.detail.originalEvent.target;
  if (target instanceof Element && target.closest("[data-sonner-toaster]")) {
    event.preventDefault();
  }
}
