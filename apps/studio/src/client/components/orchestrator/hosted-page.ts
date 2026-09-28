import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import { getWebviewElement } from "@/client/lib/browser-pool";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { isPageEditAddress } from "@instrument-org/shared";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { useEffect, useRef } from "react";

/**
 * What a page drawn inside a file tab (beside its tree) moving means for the
 * tab around it:
 *
 * - `back`: the guest stepped back past the file to the blank page every
 *   guest starts on, by a mouse's thumb button or its own menu. The file is
 *   the start of the page's history, so the step is the tab's, back to where
 *   the file was opened from.
 * - `file`: a link took the page to another file on the computer, which the
 *   tab shows in the file's place, its tree following.
 * - `site`: a link took the page off the computer, and the tab becomes the
 *   page at that address.
 *
 * Anything else (the file itself, reloaded or loaded in Edit) is the tab
 * staying where it is.
 */
export type HostedPageStep =
  | undefined
  | { kind: "back" }
  | { kind: "file"; path: string }
  | { kind: "site"; url: string };

export function hostedPageStep(
  url: string,
  { canGoForward, fileUrl }: { canGoForward: boolean; fileUrl: string },
): HostedPageStep {
  if (url === "" || isPageEditAddress(url) || sameDocument(url, fileUrl)) {
    return undefined;
  }
  if (url === "about:blank") {
    return canGoForward ? { kind: "back" } : undefined;
  }
  const path = hostPathOfFileUrl(url);
  return path === undefined ? { kind: "site", url } : { kind: "file", path };
}

/**
 * Follows the guest of a page drawn inside a file tab and hands each move
 * that takes it off the file to the tab; see `hostedPageStep`. A step back to
 * the blank start is undone in the guest first, so the page is the file again
 * if the tab comes back to it. A page going on to a site starts its own
 * history there, since what came before it is the tab's.
 */
export function useHostedPageNavigation(
  target: BrowserTargetId | undefined,
  fileUrl: string | undefined,
  onStep: (step: NonNullable<HostedPageStep>) => void,
) {
  const attached = useBrowserTargets();
  const isAttached = target !== undefined && attached.has(target);
  const latest = useRef({ fileUrl, onStep });
  useEffect(() => {
    latest.current = { fileUrl, onStep };
  });
  useEffect(() => {
    const webview = target && isAttached ? getWebviewElement(target) : null;
    if (!webview) {
      return;
    }
    const onNavigate = () => {
      const { fileUrl: shown, onStep: step } = latest.current;
      if (shown === undefined) {
        return;
      }
      let url: string;
      let canGoForward: boolean;
      try {
        url = webview.getURL();
        canGoForward = webview.canGoForward();
      } catch {
        return;
      }
      const next = hostedPageStep(url, { canGoForward, fileUrl: shown });
      if (!next) {
        return;
      }
      if (next.kind === "back") {
        webview.goForward();
      }
      // The tab's own history holds the file now, behind the page; the
      // guest's would hold it a second time.
      if (next.kind === "site") {
        webview.clearHistory();
      }
      step(next);
    };
    webview.addEventListener("did-navigate", onNavigate);
    return () => {
      webview.removeEventListener("did-navigate", onNavigate);
    };
  }, [isAttached, target]);
}

/**
 * Two addresses of one document: the same but for a fragment, or one file
 * however its path was escaped.
 */
function sameDocument(a: string, b: string) {
  const path = hostPathOfFileUrl(a);
  if (path !== undefined) {
    return path === hostPathOfFileUrl(b);
  }
  return a.replace(/#.*$/, "") === b.replace(/#.*$/, "");
}
