import { useGuest } from "@/client/hooks/use-browser-targets";
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
  const guest = useGuest(targetId);

  useEffect(() => {
    if (!guest) {
      return;
    }
    const sync = () => {
      const url = guest.url();
      if (url === "") {
        // Gone since it was handed out; its own teardown follows.
        return;
      }
      setState({
        back: guest.canGoBack(),
        forward: guest.canGoForward(),
        targetId: guest.targetId,
        url,
      });
      navigated(url);
    };
    // A committed error page makes the prior page a back entry, but
    // did-navigate doesn't reliably fire on error-page commit, so the steps are
    // read again here instead of left stale (back stuck disabled).
    const syncSteps = () => {
      const back = guest.canGoBack();
      const forward = guest.canGoForward();
      setState((current) =>
        current?.targetId === guest.targetId
          ? { ...current, back, forward }
          : current,
      );
    };
    sync();
    const stops = [
      guest.on("did-navigate", sync),
      guest.on("did-navigate-in-page", sync),
      guest.on("did-fail-load", syncSteps),
      // A redirect can move the history once loading stops without a
      // navigation event for it.
      guest.on("did-stop-loading", syncSteps),
    ];
    return () => {
      for (const stop of stops) {
        stop();
      }
      // The guest this described is being let go. Reopening the same target
      // builds a fresh one at about:blank, which is not ready to read until
      // its WebContents attaches, so an answer left standing across the gap
      // would describe a page that is no longer there.
      setState(null);
    };
  }, [guest]);

  const current = state?.targetId === targetId ? state : null;
  return {
    canGoBack: current?.back ?? false,
    canGoForward: current?.forward ?? false,
    url: current?.url ?? null,
  };
}
