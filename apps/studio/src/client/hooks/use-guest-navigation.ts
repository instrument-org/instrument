import { getWebviewElement } from "@/client/lib/browser-pool";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { useEffect, useEffectEvent, useState } from "react";

/**
 * Where a browser guest is and whether it has history to step through, kept
 * as it moves: it navigates by the user's hand and by an agent's CDP commands
 * alike, so this listens rather than polls.
 *
 * Pass `null` until the guest is there to read. The answer is stamped with the
 * guest it came from and dropped when that guest is let go, so a target that
 * changes in place reads as unknown (`url: null`, no steps) until its own
 * guest has been read, never as the previous guest's page.
 */
export function useGuestNavigation(
  targetId: BrowserTargetId | null,
  {
    onNavigate,
  }: {
    /** Called with the guest's address each time it is read, including the first read for a target. */
    onNavigate?: (url: string) => void;
  } = {},
): { canGoBack: boolean; canGoForward: boolean; url: null | string } {
  const [state, setState] = useState<null | {
    back: boolean;
    forward: boolean;
    targetId: BrowserTargetId;
    url: string;
  }>(null);
  const navigated = useEffectEvent((url: string) => {
    onNavigate?.(url);
  });

  useEffect(() => {
    const webview = targetId ? getWebviewElement(targetId) : null;
    if (!targetId || !webview) {
      return;
    }
    // getURL/canGoBack throw if the guest hasn't attached its WebContents
    // yet; the did-navigate events that also drive these only fire once it has.
    const sync = () => {
      try {
        const url = webview.getURL();
        const back = webview.canGoBack();
        const forward = webview.canGoForward();
        setState({ back, forward, targetId, url });
        navigated(url);
      } catch {
        // Not attached yet; a did-navigate will re-run sync once it is.
      }
    };
    // A committed error page makes the prior page a back entry, but
    // did-navigate doesn't reliably fire on error-page commit, so the steps are
    // read again here instead of left stale (back stuck disabled).
    const syncSteps = () => {
      try {
        const back = webview.canGoBack();
        const forward = webview.canGoForward();
        setState((current) =>
          current?.targetId === targetId
            ? { ...current, back, forward }
            : current,
        );
      } catch {
        // Not attached yet; a later did-navigate will sync.
      }
    };
    sync();
    webview.addEventListener("did-navigate", sync);
    webview.addEventListener("did-navigate-in-page", sync);
    webview.addEventListener("did-fail-load", syncSteps);
    // A redirect can move the history once loading stops without a
    // navigation event for it.
    webview.addEventListener("did-stop-loading", syncSteps);
    return () => {
      webview.removeEventListener("did-navigate", sync);
      webview.removeEventListener("did-navigate-in-page", sync);
      webview.removeEventListener("did-fail-load", syncSteps);
      webview.removeEventListener("did-stop-loading", syncSteps);
      // The guest this described is being let go. Reopening the same target
      // builds a fresh one at about:blank, and `sync()` cannot read that until
      // its WebContents attaches, so an answer left standing across the gap
      // would describe a page that is no longer there.
      setState(null);
    };
  }, [targetId]);

  const current = state?.targetId === targetId ? state : null;
  return {
    canGoBack: current?.back ?? false,
    canGoForward: current?.forward ?? false,
    url: current?.url ?? null,
  };
}
