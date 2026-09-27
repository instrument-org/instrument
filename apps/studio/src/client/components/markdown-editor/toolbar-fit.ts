/** The space kept between the selection toolbar and the edge it is held inside. */
const EDGE_PAD = 8;

/** The gap Crepe leaves between the toolbar and the selection it stands by. */
const SELECTION_GAP = 10;

/**
 * Holds Crepe's selection toolbar inside the editor's scroll container and the
 * window. Crepe places it with floating-ui, whose `shift` cannot help a
 * toolbar wider than the space (a narrow pane), whose boundary is not the
 * scroll container, and which does not correct for the app's CSS `zoom`. So
 * each time it is placed, it is capped to the space's width (wrapping onto a
 * second row when that is not enough), moved back inside sideways, and put
 * below the selection when there is no room above it. Returns the teardown.
 */
export function fitSelectionToolbar(
  root: HTMLElement,
  selectionBox: () => null | { bottom: number; top: number },
): () => void {
  const fit = (toolbar: HTMLElement) => {
    if (toolbar.dataset.show !== "true" || toolbar.offsetWidth === 0) {
      return;
    }
    const scroller = scrollParentOf(root)?.getBoundingClientRect();
    const view = document.documentElement;
    const left = Math.max(scroller?.left ?? 0, 0) + EDGE_PAD;
    const right =
      Math.min(scroller?.right ?? Infinity, view.clientWidth) - EDGE_PAD;
    const top = Math.max(scroller?.top ?? 0, 0) + EDGE_PAD;
    // On-screen px per layout px, which is the zoom the editor is drawn at.
    // Read off the editor rather than the toolbar, and the cap rounded down,
    // so that capping the toolbar's width cannot change the next reading.
    const scale = root.getBoundingClientRect().width / root.offsetWidth || 1;
    const maxWidth = `${Math.floor(Math.max(right - left, 0) / scale)}px`;
    if (toolbar.style.maxWidth !== maxWidth) {
      toolbar.style.maxWidth = maxWidth;
    }
    const box = toolbar.getBoundingClientRect();
    // The left edge wins when even the capped toolbar is wider than the space.
    const dx = Math.max(left - box.left, Math.min(right - box.right, 0));
    if (Math.abs(dx) >= 0.5) {
      const at = Number.parseFloat(toolbar.style.left) || toolbar.offsetLeft;
      toolbar.style.left = `${at + dx / scale}px`;
    }
    const selection = box.top < top ? selectionBox() : null;
    if (selection && box.top < selection.top) {
      const dy = selection.bottom + SELECTION_GAP - box.top;
      const at = Number.parseFloat(toolbar.style.top) || toolbar.offsetTop;
      toolbar.style.top = `${at + dy / scale}px`;
    }
  };
  // Crepe appends the toolbar on its first update and repositions it by
  // writing `left`/`top`, so every placement shows up as a style change.
  const observer = new MutationObserver((records) => {
    for (const { target } of records) {
      if (
        target instanceof HTMLElement &&
        target.classList.contains("milkdown-toolbar")
      ) {
        fit(target);
      }
    }
  });
  observer.observe(root, {
    attributeFilter: ["style", "data-show"],
    subtree: true,
  });
  return () => {
    observer.disconnect();
  };
}

/** The nearest ancestor that scrolls vertically, which is where the editor's page scrolls. */
export function scrollParentOf(element: HTMLElement): HTMLElement | null {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === "auto" || overflowY === "scroll") {
      return at;
    }
  }
  return null;
}
