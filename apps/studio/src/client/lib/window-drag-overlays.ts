/**
 * Whether an overlay that folds at a press anywhere else is open, kept on the
 * root as `data-overlay-open` for the stylesheet, which turns every window
 * drag area off while it is there (`globals.css`). A drag area hands a press
 * to the system as a window move, so the document would never see the press
 * that puts the overlay away.
 *
 * Read from the document rather than set by each overlay, so it lasts exactly
 * as long as an open one is in it and no overlay's cleanup can leave the
 * window stuck in place. Radix's menus, popovers, selects and dialogs carry
 * their role and `data-state="open"` on their content; a floating panel of
 * our own marks itself `data-no-window-drag` while it is shown, and the
 * Markdown editor's menus (`.md-popover`) are in the document only while
 * open. Tooltips and hover cards have no such role, so showing one leaves
 * dragging alone.
 *
 * Not a `:root:has(...)` rule: that makes the root a `:has()` subject, and
 * Chromium then restyles the whole document whenever a subtree with a role or
 * a `data-state` in it lands anywhere, as each row of a streaming reply does.
 */
const OPEN_OVERLAY = `:is([role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"])[data-state="open"], [data-no-window-drag], .md-popover`;

const holdsOverlay = (node: Node) =>
  node instanceof Element &&
  (node.matches(OPEN_OVERLAY) || node.querySelector(OPEN_OVERLAY) !== null);

/** Keeps `data-overlay-open` on the root in step with the document. Returns the function that stops. */
export function watchOpenOverlays(root = document.documentElement) {
  const settle = () => {
    root.toggleAttribute(
      "data-overlay-open",
      root.querySelector(OPEN_OVERLAY) !== null,
    );
  };
  const observer = new MutationObserver((records) => {
    // A record that cannot have opened or closed one is most of them while a
    // reply streams in, so only one that can reads the whole document.
    const isRelevant = records.some(
      (record) =>
        record.type === "attributes" ||
        [...record.addedNodes].some(holdsOverlay) ||
        [...record.removedNodes].some(holdsOverlay),
    );
    if (isRelevant) {
      settle();
    }
  });
  observer.observe(root, {
    attributeFilter: ["data-state", "data-no-window-drag", "role"],
    attributes: true,
    childList: true,
    subtree: true,
  });
  settle();
  return () => {
    observer.disconnect();
  };
}
