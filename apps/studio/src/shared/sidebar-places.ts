import { z } from "zod";

/**
 * The person's changes to the Files sidebar's Pinned section, by host path:
 * the folders they pinned, in the order they pinned them, and the default
 * places they unpinned. The defaults themselves are not stored, so a default
 * a later release adds still shows, and unpinning one only hides it.
 */
export const SidebarPlacesSchema = z.object({
  pinned: z.array(z.string()).default([]),
  unpinned: z.array(z.string()).default([]),
});
export type SidebarPlaces = z.output<typeof SidebarPlacesSchema>;

export const NO_SIDEBAR_CHANGES: SidebarPlaces = { pinned: [], unpinned: [] };

export function pinPlace(places: SidebarPlaces, path: string): SidebarPlaces {
  return {
    pinned: places.pinned.includes(path)
      ? places.pinned
      : [...places.pinned, path],
    unpinned: places.unpinned.filter((each) => each !== path),
  };
}

export function unpinPlace(places: SidebarPlaces, path: string): SidebarPlaces {
  return {
    pinned: places.pinned.filter((each) => each !== path),
    unpinned: places.unpinned.includes(path)
      ? places.unpinned
      : [...places.unpinned, path],
  };
}

/** The defaults back where they were; the folders the person pinned stay. */
export function restoreDefaultPlaces(places: SidebarPlaces): SidebarPlaces {
  return { ...places, unpinned: [] };
}

/**
 * A folder the app renamed or moved from `from` to `to`: a pin on it, or on
 * a folder inside it, follows it. `separator` is the host's.
 */
export function moveSidebarPlaces(
  places: SidebarPlaces,
  from: string,
  to: string,
  separator: string,
): SidebarPlaces {
  const follow = (path: string) =>
    path === from || path.startsWith(`${from}${separator}`)
      ? `${to}${path.slice(from.length)}`
      : path;
  return {
    pinned: places.pinned.map(follow),
    unpinned: places.unpinned.map(follow),
  };
}

/**
 * The Pinned section's rows: the defaults the person has not unpinned, in
 * their own order, then what the person pinned, in the order pinned. A
 * default pinned again stands in its default place rather than twice.
 */
export function pinnedPlaces<Place extends { path: string }>(
  defaults: readonly Place[],
  places: SidebarPlaces,
  placeOf: (path: string) => Place,
): Place[] {
  const shown = defaults.filter(
    (place) => !places.unpinned.includes(place.path),
  );
  const defaultPaths = new Set(defaults.map((place) => place.path));
  return [
    ...shown,
    ...places.pinned
      .filter((path) => !defaultPaths.has(path))
      .map((path) => placeOf(path)),
  ];
}
