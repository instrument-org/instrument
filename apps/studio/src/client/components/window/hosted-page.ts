import { useGuest } from "@/client/hooks/use-browser-targets";
import { onPageThumb } from "@/client/lib/browser-pool";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { isPageEditAddress } from "@instrument-org/shared";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { useEffect, useRef } from "react";

/**
 * What a page drawn inside a file tab (beside its tree) moving means for the
 * tab around it:
 *
 * - `back`: the mouse's back button pressed over the page, or the back
 *   chord pressed in it, with nothing of the page's own behind it. The file
 *   is the start of the page's history, so the step is the tab's, back to
 *   where the file was opened from.
 * - `forward`: the same forward, with nothing of the page's own ahead of it:
 *   the tab's step forward.
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
  | { kind: "forward" }
  | { kind: "file"; path: string }
  | { kind: "site"; url: string };

export function hostedPageStep(
  url: string,
  { fileUrl }: { fileUrl: string },
): HostedPageStep {
  if (url === "" || isPageEditAddress(url) || sameDocument(url, fileUrl)) {
    return undefined;
  }
  if (url === "about:blank") {
    return undefined;
  }
  const path = hostPathOfFileUrl(url);
  return path === undefined ? { kind: "site", url } : { kind: "file", path };
}

/**
 * Follows the guest of a page drawn inside a file tab and hands each move
 * that takes it off the file to the tab; see `hostedPageStep`. The mouse's
 * thumb buttons over the page walk the page's own history, and a step past
 * either end of it is the tab's. A page going on to a site starts its own history
 * there, since what came before it is the tab's.
 */
export function useHostedPageNavigation(
  target: BrowserTargetId | undefined,
  fileUrl: string | undefined,
  onStep: (step: NonNullable<HostedPageStep>) => void,
) {
  const guest = useGuest(target);
  const latest = useRef({ fileUrl, onStep });
  useEffect(() => {
    latest.current = { fileUrl, onStep };
  });
  useEffect(() => {
    if (target === undefined || !guest) {
      return;
    }
    const onNavigate = () => {
      const { fileUrl: shown, onStep: step } = latest.current;
      if (shown === undefined) {
        return;
      }
      const next = hostedPageStep(guest.url(), { fileUrl: shown });
      if (!next) {
        return;
      }
      // The tab's own history holds the file now, behind the page; the
      // guest's would hold it a second time.
      if (next.kind === "site") {
        guest.clearHistory();
      }
      step(next);
    };
    const stopNavigate = guest.on("did-navigate", onNavigate);
    const releaseThumbs = onPageThumb(target, (direction) => {
      if (!guest.step(direction) && latest.current.fileUrl !== undefined) {
        latest.current.onStep({ kind: direction });
      }
    });
    return () => {
      stopNavigate();
      releaseThumbs();
    };
  }, [guest, target]);
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
