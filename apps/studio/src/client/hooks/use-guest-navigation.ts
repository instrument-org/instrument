import { getWebviewElement } from "@/client/lib/browser-pool";
import { BROWSER_ZOOM_MAX, BROWSER_ZOOM_MIN } from "@/shared/browser";
import { steppedZoom } from "@/shared/zoom";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { useEffect, useEffectEvent, useState } from "react";

export interface GuestLoadError {
  message: string;
  url: string;
}

// Shape of the `<webview>` `did-fail-load` DOM event (Electron adds these
// fields; the DOM lib types it as a plain Event).
interface DidFailLoadEvent extends Event {
  errorCode: number;
  errorDescription: string;
  isMainFrame: boolean;
  validatedURL: string;
}

/**
 * Navigation state and controls for a pooled browser guest, shared by every
 * surface that hosts one: the task's agent browser and the HTML artifact
 * preview.
 *
 * The guest navigates from more than the controls here -- agent CDP commands
 * for the session guest, in-page links for both -- so back/forward availability
 * and the current URL are mirrored off the guest's own events rather than
 * tracked from what this hook was asked to do.
 *
 * `isUrlEditing` lets a host with an address bar hold off URL syncing while the
 * user is typing in it; a host without one omits it.
 */
export function useGuestNavigation({
  active,
  isUrlEditing,
  targetId,
}: {
  active: boolean;
  isUrlEditing?: () => boolean;
  targetId: BrowserTargetId;
}) {
  const [nav, setNav] = useState({ back: false, forward: false });
  const [url, setUrl] = useState("");
  const [zoomFactor, setZoomFactor] = useState(1);
  // Set when a main-frame navigation fails (bad host, no network, ...). The
  // guest is parked and the host shows its own error state over the slot
  // instead of the guest's blank error page.
  //
  // Stamped with the guest it happened on, and read back only for that one. The
  // browser panel swaps `targetId` in place when the selected session changes,
  // without a remount, so a bare error would survive into the next guest and
  // both park it behind a notice and name the previous session's URL. Filtering
  // on read rather than clearing in an effect keeps that out of a second render
  // pass, so no failed page is ever briefly shown as fine.
  const [failure, setFailure] = useState<null | {
    error: GuestLoadError;
    targetId: BrowserTargetId;
  }>(null);
  const loadError =
    active && failure?.targetId === targetId ? failure.error : null;

  // Reads the host's latest editing state without making it a dependency, so
  // the sync effect doesn't tear down and re-subscribe as the user focuses and
  // blurs an address bar.
  const isEditing = useEffectEvent(() => isUrlEditing?.() ?? false);

  useEffect(() => {
    if (!active) {
      return;
    }
    const webview = getWebviewElement(targetId);
    if (!webview) {
      return;
    }
    const sync = () => {
      // getURL/canGoBack throw if the guest hasn't attached its WebContents yet;
      // the did-navigate events that also drive this only fire once it has.
      try {
        if (!isEditing()) {
          const next = webview.getURL();
          setUrl(next === "about:blank" ? "" : next);
        }
        setNav({ back: webview.canGoBack(), forward: webview.canGoForward() });
      } catch {
        // Not attached yet; a did-navigate will re-run sync once it is.
      }
    };
    const onNavigate = () => {
      setFailure(null);
      sync();
    };
    const onStartLoading = () => {
      setFailure(null);
    };
    const onFailLoad = (event: Event) => {
      const detail = event as DidFailLoadEvent;
      // Ignore sub-frame failures and user-aborted navigations (ERR_ABORTED),
      // which fire routinely when a new navigation supersedes an in-flight one.
      if (!detail.isMainFrame || detail.errorCode === -3) {
        return;
      }
      setFailure({
        error: {
          message: detail.errorDescription || "This site can’t be reached",
          url: detail.validatedURL,
        },
        targetId,
      });
      if (!isEditing() && detail.validatedURL) {
        setUrl(detail.validatedURL);
      }
      // A committed error page makes the prior page a back entry, but
      // did-navigate doesn't reliably fire on error-page commit, so refresh the
      // nav buttons here instead of leaving them stale (back stuck disabled).
      try {
        setNav({ back: webview.canGoBack(), forward: webview.canGoForward() });
      } catch {
        // Guest not attached yet; a later did-navigate will sync.
      }
    };
    sync();
    webview.addEventListener("did-navigate", onNavigate);
    webview.addEventListener("did-navigate-in-page", onNavigate);
    webview.addEventListener("did-start-loading", onStartLoading);
    webview.addEventListener("did-fail-load", onFailLoad);
    return () => {
      webview.removeEventListener("did-navigate", onNavigate);
      webview.removeEventListener("did-navigate-in-page", onNavigate);
      webview.removeEventListener("did-start-loading", onStartLoading);
      webview.removeEventListener("did-fail-load", onFailLoad);
    };
  }, [active, targetId]);

  const webviewFor = () => getWebviewElement(targetId);

  // loadURL rejects on a failed navigation (bad host, offline, ...); the
  // did-fail-load listener already surfaces the error, so swallow the rejection
  // to avoid an unhandled promise error.
  const navigateTo = (next: string) => {
    void webviewFor()
      ?.loadURL(next)
      .catch(() => {
        // Surfaced by the did-fail-load listener; nothing to do here.
      });
  };

  const applyZoom = (factor: number) => {
    const webview = webviewFor();
    if (!webview) {
      return;
    }
    webview.setZoomFactor(factor);
    setZoomFactor(factor);
  };

  return {
    applyZoom,
    canGoBack: nav.back,
    canGoForward: nav.forward,
    /** Live read of the guest's URL, or undefined if it holds no real page. */
    currentUrl: () => {
      try {
        // getURL throws until the guest's WebContents is dom-ready; `active` can
        // lead that (it round-trips through main), so treat a throw as "no page".
        const next = webviewFor()?.getURL();
        return next && next !== "about:blank" ? next : undefined;
      } catch {
        return;
      }
    },
    goBack: () => webviewFor()?.goBack(),
    goForward: () => webviewFor()?.goForward(),
    hardReload: () => webviewFor()?.reloadIgnoringCache(),
    loadError,
    navigateTo,
    reload: () => webviewFor()?.reload(),
    // Re-read the guest's own zoom before showing it: zoom is per-page and the
    // guest may have been zoomed by a keyboard chord this hook never saw.
    syncZoomFactor: () => {
      const webview = webviewFor();
      if (!webview) {
        return;
      }
      try {
        setZoomFactor(webview.getZoomFactor());
      } catch {
        // Not dom-ready yet; keep the last known zoom.
      }
    },
    url,
    zoomFactor,
    zoomIn: () => {
      applyZoom(
        steppedZoom({
          direction: "in",
          factor: zoomFactor,
          max: BROWSER_ZOOM_MAX,
          min: BROWSER_ZOOM_MIN,
        }),
      );
    },
    zoomOut: () => {
      applyZoom(
        steppedZoom({
          direction: "out",
          factor: zoomFactor,
          max: BROWSER_ZOOM_MAX,
          min: BROWSER_ZOOM_MIN,
        }),
      );
    },
  };
}
