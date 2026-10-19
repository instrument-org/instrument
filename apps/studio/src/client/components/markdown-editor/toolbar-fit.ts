import { watchPlacement } from "./placement";

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
  return watchPlacement(root, "milkdown-toolbar", fit);
}

/** The gap Crepe leaves between the slash menu and the line it opened on. */
const MENU_GAP = 10;

/** The tallest Crepe's stylesheet lets the slash menu's list grow, in layout px. */
const MENU_LIST_CAP = 420;

/**
 * Holds Crepe's slash menu, which the block handle's plus opens too, inside
 * the editor's scroll container and the window. Crepe places it below the
 * line with floating-ui's `flip`, which keeps it there when neither side fits
 * it whole, and which neither knows the scroll container nor corrects for the
 * app's CSS `zoom`, so left alone the end of the list can sit past the bottom
 * of the window. So each time it is placed it goes below the line when the whole list fits
 * there, above when it fits there instead, and otherwise on the roomier side
 * with its list cut to the room and scrolling. Returns the teardown.
 */
export function fitSlashMenu(
  root: HTMLElement,
  lineBox: () => { bottom: number; top: number },
): () => void {
  const fit = (menu: HTMLElement) => {
    const groups = menu.querySelector<HTMLElement>(".menu-groups");
    if (menu.dataset.show !== "true" || menu.offsetHeight === 0 || !groups) {
      return;
    }
    const scroller = scrollParentOf(root)?.getBoundingClientRect();
    const view = document.documentElement;
    const top = Math.max(scroller?.top ?? 0, 0) + EDGE_PAD;
    const bottom =
      Math.min(scroller?.bottom ?? Infinity, view.clientHeight) - EDGE_PAD;
    const left = Math.max(scroller?.left ?? 0, 0) + EDGE_PAD;
    const right =
      Math.min(scroller?.right ?? Infinity, view.clientWidth) - EDGE_PAD;
    // On-screen px per layout px; see fitSelectionToolbar.
    const scale = root.getBoundingClientRect().width / root.offsetWidth || 1;
    const line = lineBox();
    // The menu's height, in layout px, with its whole list showing, and with
    // the list's own cap from Crepe's stylesheet rather than the one set here.
    const chrome = menu.offsetHeight - groups.offsetHeight;
    const whole =
      (chrome + Math.min(groups.scrollHeight, MENU_LIST_CAP)) * scale;
    const below = bottom - (line.bottom + MENU_GAP);
    const above = line.top - MENU_GAP - top;
    const goesBelow = whole <= below || (whole > above && below >= above);
    const height = Math.min(whole, Math.max(goesBelow ? below : above, 0));
    const maxHeight = `${Math.floor(Math.max(height / scale - chrome, 0))}px`;
    if (groups.style.maxHeight !== maxHeight) {
      groups.style.maxHeight = maxHeight;
    }
    const box = menu.getBoundingClientRect();
    const wantTop = goesBelow
      ? line.bottom + MENU_GAP
      : line.top - MENU_GAP - height;
    const dy = wantTop - box.top;
    if (Math.abs(dy) >= 0.5) {
      const at = Number.parseFloat(menu.style.top) || menu.offsetTop;
      menu.style.top = `${at + dy / scale}px`;
    }
    const dx = Math.max(left - box.left, Math.min(right - box.right, 0));
    if (Math.abs(dx) >= 0.5) {
      const at = Number.parseFloat(menu.style.left) || menu.offsetLeft;
      menu.style.left = `${at + dx / scale}px`;
    }
  };
  return watchPlacement(root, "milkdown-slash-menu", fit);
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
