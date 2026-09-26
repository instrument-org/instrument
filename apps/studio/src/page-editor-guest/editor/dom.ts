/**
 * Finding the editor's own elements. Its markup is its own, so an element
 * it looks for and does not find is a bug, and says so.
 */

/** The nearest ancestor-or-self of an event's target matching `selector`. */
export function closestIn(e: Event, selector: string) {
  return e.target instanceof Element
    ? e.target.closest<HTMLElement>(selector)
    : null;
}

/** An element the editor's own markup always has. */
export function find(root: ParentNode, selector: string): HTMLElement {
  return findAs(root, selector, HTMLElement);
}

/** An element the editor's own markup always has, of a known type. */
export function findAs<T extends Element>(
  root: ParentNode,
  selector: string,
  type: new () => T,
): T {
  const el = root.querySelector(selector);
  if (!(el instanceof type)) {
    throw new TypeError(`The editor has no ${selector}`);
  }
  return el;
}

/** Text made safe to put in markup. */
export const esc = (s: string) =>
  s.replaceAll(
    /[&<>"]/g,
    (c) => ({ '"': "&quot;", "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c,
  );
