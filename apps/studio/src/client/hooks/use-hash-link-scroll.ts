import { zoomAtom } from "@/client/atoms/zoom";
import { useAtomValue } from "jotai";
import { useCallback } from "react";

import { useReleaseAutoScroll } from "../components/transcript-scroll-context";

/**
 * The element a `#fragment` names, under either spelling it can carry.
 *
 * `rehype-slug` names a heading after its own text, so a timestamp heading
 * becomes the id `0700` -- which `querySelector("#0700")` cannot ask for, an id
 * selector being unable to start with a digit. Matching on the attribute is
 * what makes any name askable.
 *
 * The second spelling is the sanitize pass's: an id written in raw HTML is
 * rewritten to `user-content-<id>` so that a document cannot clobber a property
 * of `window`. A link in that same document still points at the name its author
 * wrote, so both are tried.
 */
const findFragmentTarget = (root: Document | Element, fragment: string) => {
  let id = fragment;
  try {
    id = decodeURIComponent(fragment);
  } catch {
    // Keep the raw fragment when it isn't valid percent-encoding.
  }

  const byId = (name: string) =>
    root.querySelector(`[id="${name.replaceAll(/["\\]/g, String.raw`\$&`)}"]`);

  return byId(id) ?? byId(`user-content-${id}`);
};

export const useHashLinkScroll = () => {
  const zoom = useAtomValue(zoomAtom);
  const releaseAutoScroll = useReleaseAutoScroll();
  const handleHashLinkClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      const href = event.currentTarget.getAttribute("href");
      if (href?.startsWith("#")) {
        // Find the root element to search within (walk up to find a scroll container first)
        let searchRoot: Document | Element = event.currentTarget;
        let tempParent = event.currentTarget.parentElement;
        while (tempParent && tempParent !== document.body) {
          const style = window.getComputedStyle(tempParent);
          const overflowY = style.overflowY;
          if (overflowY === "auto" || overflowY === "scroll") {
            searchRoot = tempParent;
            break;
          }
          tempParent = tempParent.parentElement;
        }
        if (searchRoot === event.currentTarget) {
          searchRoot = document;
        }

        const element = findFragmentTarget(searchRoot, href.slice(1));
        if (element) {
          // The smooth scroll below is programmatic, so the transcript's
          // scroller never counts it as the reader taking over: left following
          // the live end, the next content growth pulls the view back to the
          // bottom instead of leaving it at the target.
          releaseAutoScroll();
          // Find the nearest scrollable ancestor by checking computed styles
          let scrollContainer = element.parentElement;
          while (scrollContainer && scrollContainer !== document.body) {
            const style = window.getComputedStyle(scrollContainer);
            const overflowY = style.overflowY;
            // Check if element has overflow auto/scroll (even if not currently scrollable)
            if (overflowY === "auto" || overflowY === "scroll") {
              break;
            }
            scrollContainer = scrollContainer.parentElement;
          }

          if (scrollContainer && scrollContainer !== document.body) {
            // Get element position relative to scroll container
            const elementRect = element.getBoundingClientRect();
            const containerRect = scrollContainer.getBoundingClientRect();
            // The rect delta is on-screen px (scaled by the app zoom); scrollTop
            // and scrollTo expect layout px, so divide the delta back.
            const relativeTop = (elementRect.top - containerRect.top) / zoom;
            const scrollOffset = scrollContainer.scrollTop;

            scrollContainer.scrollTo({
              behavior: "smooth",
              top: scrollOffset + relativeTop,
            });
          } else {
            element.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      }
    },
    [releaseAutoScroll, zoom],
  );

  return handleHashLinkClick;
};
