/**
 * Lights `element` for a moment, so the eye lands on the heading a jump just
 * put at the top of the view rather than searching the page for it.
 *
 * The class is taken off again when its animation ends, and removed before it
 * is added so a target still lit from the last jump starts over rather than
 * carrying on from wherever it was. Reading a layout property in between is
 * what makes the browser see the removal at all: without it the two class
 * changes collapse into no change, and the animation does not restart.
 */
export function flashJumpTarget(element: Element): void {
  element.classList.remove("jump-flash");
  element.getBoundingClientRect();
  element.classList.add("jump-flash");
  element.addEventListener(
    "animationend",
    () => {
      element.classList.remove("jump-flash");
    },
    { once: true },
  );
}
