import { useEffect, useEffectEvent } from "react";

/**
 * Cmd/Ctrl+C for a viewer whose selection the browser cannot see.
 *
 * A canvas grid and a pdfium page both keep their selection inside the engine,
 * so `document.getSelection()` is empty, the browser never raises a `copy`
 * event, and the keystroke has to be intercepted for anything to reach the
 * clipboard at all.
 *
 * Intercepting it means deciding which viewer owns it. Focus is the arbiter:
 * the same file can be open in the artifact panel and the expand modal at once,
 * and an engine-held selection is not cleared by focus moving away, so a
 * viewer left holding one would otherwise answer for a copy made in the chat.
 *
 * `onCopy` reports whether it had anything to copy. Only then is the browser's
 * own handling suppressed, so a viewer with no selection leaves the clipboard
 * and every other copy path alone.
 */
export function useCopyShortcut({
  container,
  onCopy,
}: {
  container: HTMLElement | null;
  onCopy: () => boolean;
}) {
  // `onCopy` closes over its viewer's selection state, so it is a different
  // function on every render. Held as an effect event, the listener subscribes
  // once per container instead of being torn down and re-added each time.
  const copy = useEffectEvent(onCopy);

  useEffect(() => {
    if (!container) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "c" || !(event.metaKey || event.ctrlKey)) {
        return;
      }
      if (!container.contains(document.activeElement)) {
        return;
      }
      if (copy()) {
        event.preventDefault();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [container]);
}
