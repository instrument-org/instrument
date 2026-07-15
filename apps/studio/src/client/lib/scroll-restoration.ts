import { type ParsedLocation } from "@tanstack/react-router";

import { type FileRouteTypes } from "../routeTree.gen";

// Validated against the generated route tree so a route move/rename fails to
// compile instead of silently re-enabling restoration for tasks.
const taskDetailPath = "/tasks/$id/" satisfies FileRouteTypes["fullPaths"];
const taskDetailPrefix = taskDetailPath.slice(0, taskDetailPath.indexOf("$"));

// The chat transcript is bottom-anchored and its height differs between
// visits (streaming, async rendering), so restoring an absolute scroll offset
// on history back/forward parks it mid-transcript — and offsets even leak
// across tasks, since restoration keys elements by DOM path and carries the
// previous location's entries forward. The MessageScroller owns its own
// position, so task detail pages opt out; every other page keeps
// element-level restoration.
export function shouldRestoreScroll({
  location,
}: {
  location: ParsedLocation;
}) {
  return !location.pathname.startsWith(taskDetailPrefix);
}
