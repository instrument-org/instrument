/**
 * Calls back each time Crepe places one of its floating elements, named by
 * its class: the selection toolbar, the block handle. Crepe appends them on
 * its first update and places them by writing `left`/`top` and `data-show`,
 * so every placement shows up as an attribute change somewhere under the
 * editor's root. Returns the teardown.
 */
export function watchPlacement(
  root: HTMLElement,
  className: string,
  onPlace: (element: HTMLElement) => void,
): () => void {
  const observer = new MutationObserver((records) => {
    for (const { target } of records) {
      if (
        target instanceof HTMLElement &&
        target.classList.contains(className)
      ) {
        onPlace(target);
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
