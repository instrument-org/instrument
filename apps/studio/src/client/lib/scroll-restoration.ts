import { type ParsedLocation } from "@tanstack/react-router";

import { type FileRouteTypes } from "../routeTree.gen";

/**
 * Pages whose scroll position belongs to a `MessageScroller` rather than to the
 * document.
 *
 * Restoration keys elements by DOM path and, on every navigation, copies the
 * previous location's entries forward onto the new one for any selector that
 * still resolves. It then writes those offsets after the render. So the scroller
 * on the page being *entered* is handed the offset of the scroller on the page
 * being left, and a React key on the content cannot prevent it: the element is
 * new, but it is found by selector and written to afterwards.
 *
 * That is wrong even when it is the same transcript, since these are
 * bottom-anchored and their height differs between visits as content streams in
 * and renders asynchronously. The scroller owns its own position, so these pages
 * opt out; every other page keeps element-level restoration.
 *
 * Validated against the generated route tree so a route move or rename fails to
 * compile instead of silently re-enabling restoration.
 */
const SCROLLER_OWNED_PATHS = [
  "/debug/components/transcript",
  "/tasks/$id/",
] satisfies FileRouteTypes["fullPaths"][];

// A path parameter cannot be compared literally, so an entry carrying one is
// matched by what precedes it.
const scrollerOwnedPrefixes = SCROLLER_OWNED_PATHS.map((path) => {
  const parameter = path.indexOf("$");
  return parameter === -1 ? path : path.slice(0, parameter);
});

export function shouldRestoreScroll({
  location,
}: {
  location: ParsedLocation;
}) {
  return !scrollerOwnedPrefixes.some((prefix) =>
    location.pathname.startsWith(prefix),
  );
}
