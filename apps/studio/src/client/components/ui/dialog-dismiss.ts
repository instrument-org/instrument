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

/**
 * A short side-to-side shake for a dialog that stays open because a click
 * outside would lose what was typed into it, so the click reads as refused
 * rather than missed. Nothing under reduced motion.
 */
export function shakeInPlace(element: HTMLElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  element.animate(
    [0, -10, 10, -7, 7, -3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
    { duration: 400, easing: "ease-out" },
  );
}
