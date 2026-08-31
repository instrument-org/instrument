import { type AnyRouter } from "@tanstack/react-router";

/**
 * Whether a navigation target resolves to the location the tab is already
 * showing: a press that asked for the page it is on. The router answers one of
 * these by reloading the matches it already has, so nothing about the page
 * moves and nothing remounts -- which is why the surfaces that care have to be
 * told (see `bumpPromptNudgeAtom`).
 *
 * Built the way the navigation itself builds it. Search a route validates into
 * its URL is part of the location that gets committed, and `buildLocation`
 * leaves it out unless asked, so a schema that fills in a default is enough to
 * make a route never match the location it is already on.
 */
export function isCurrentLocation(
  router: AnyRouter,
  target: Parameters<AnyRouter["buildLocation"]>[0],
): boolean {
  return (
    router.buildLocation({ ...target, _includeValidateSearch: true }).href ===
    router.state.location.href
  );
}
