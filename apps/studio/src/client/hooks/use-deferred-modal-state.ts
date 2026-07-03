import { useEffect, useState } from "react";

// Safety net only. The real signal is the caller invoking `onExitComplete`
// from `DialogContent`'s `onExitComplete` (wired to the actual CSS
// animationend event), so this never fires in normal operation — it just
// guards against a missed/interrupted event (backgrounded tab, cancelled
// animation) so content doesn't stay stuck mounted forever. Comfortably
// longer than any dialog's declared exit duration (`duration-200`).
const EXIT_FALLBACK_MS = 1000;

/**
 * Keeps returning the last non-null modal state for the duration of the
 * Radix exit animation instead of clearing to `null` the instant the
 * backing atom does. Callers gate their `DialogContent` on `content` (not
 * the raw atom) and forward `onExitComplete` to `DialogContent`'s prop of the
 * same name, so `data-[state=closed]:animate-out` has time to play before
 * the content unmounts; the raw atom still drives `<Dialog open>`
 * immediately so the animation starts right away.
 */
export function useDeferredModalState<T>(state: null | T): {
  content: null | T;
  onExitComplete: () => void;
} {
  const [lastNonNull, setLastNonNull] = useState(state);
  if (state !== null && state !== lastNonNull) {
    setLastNonNull(state);
  }

  const [showContent, setShowContent] = useState(state !== null);
  // Reopening while a close is pending (or after it already finished)
  // should show content again immediately, not wait on the previous close.
  if (state !== null && !showContent) {
    setShowContent(true);
  }

  useEffect(() => {
    if (state !== null) {
      return;
    }
    const timeout = setTimeout(() => {
      setShowContent(false);
    }, EXIT_FALLBACK_MS);
    return () => {
      clearTimeout(timeout);
    };
  }, [state]);

  return {
    content: showContent ? lastNonNull : null,
    onExitComplete: () => {
      setShowContent(false);
    },
  };
}
