import { z } from "zod";

/**
 * The person's changes to the Files sidebar's Favorites section, by host path:
 * the folders they added, in the order they added them, and the default
 * places they removed. The defaults themselves are not stored, so a default
 * a later release adds still shows, and removing one only hides it. `order`
 * is the system file manager's order once its pins are adopted: the rows it
 * names stand in that order, ahead of the rest.
 */
export const FavoriteChangesSchema = z.object({
  added: z.array(z.string()).default([]),
  removed: z.array(z.string()).default([]),
  order: z.array(z.string()).default([]),
});
export type FavoriteChanges = z.output<typeof FavoriteChangesSchema>;

export const NO_FAVORITE_CHANGES: FavoriteChanges = {
  added: [],
  removed: [],
  order: [],
};

const PinnedPlacesSchema = z.looseObject({
  sidebarPlaces: z.object({
    pinned: z.array(z.string()).default([]),
    unpinned: z.array(z.string()).default([]),
    order: z.array(z.string()).default([]),
  }),
});

/**
 * Stored preferences with the section's changes where this build keeps them.
 * A build that called Favorites "Pinned" kept them under `sidebarPlaces`, as
 * the folders `pinned` and `unpinned`. Anything else is answered as found.
 */
export function withFavoriteChanges(stored: unknown): unknown {
  const earlier = PinnedPlacesSchema.safeParse(stored);
  if (!earlier.success) {
    return stored;
  }
  const { sidebarPlaces, ...rest } = earlier.data;
  return {
    favoriteChanges: {
      added: sidebarPlaces.pinned,
      order: sidebarPlaces.order,
      removed: sidebarPlaces.unpinned,
    },
    ...rest,
  };
}

/**
 * A folder added, at the end of Favorites, or at its place in `order`: the
 * rows' paths as they stand once it is added, which moves a row added
 * already.
 */
export function addFavorite(
  places: FavoriteChanges,
  path: string,
  order?: readonly string[],
): FavoriteChanges {
  return {
    ...places,
    ...(order ? { order: [...order] } : {}),
    added: places.added.includes(path) ? places.added : [...places.added, path],
    removed: places.removed.filter((each) => each !== path),
  };
}

export function removeFavorite(
  places: FavoriteChanges,
  path: string,
): FavoriteChanges {
  return {
    ...places,
    added: places.added.filter((each) => each !== path),
    removed: places.removed.includes(path)
      ? places.removed
      : [...places.removed, path],
  };
}

/**
 * A folder the app renamed or moved from `from` to `to`: a favorite on it, or on
 * a folder inside it, follows it. `separator` is the host's.
 */
export function moveFavorites(
  places: FavoriteChanges,
  from: string,
  to: string,
  separator: string,
): FavoriteChanges {
  const follow = (path: string) =>
    path === from || path.startsWith(`${from}${separator}`)
      ? `${to}${path.slice(from.length)}`
      : path;
  return {
    added: places.added.map(follow),
    removed: places.removed.map(follow),
    order: places.order.map(follow),
  };
}

/**
 * The Favorites section's rows: the defaults the person has not removed, in
 * their own order, then what the person added, in the order added. A
 * default added again stands in its default place rather than twice. The
 * rows `order` names come first, in its order.
 */
export function favoritePlaces<Place extends { path: string }>(
  defaults: readonly Place[],
  places: FavoriteChanges,
  placeOf: (path: string) => Place,
): Place[] {
  const shown = defaults.filter(
    (place) => !places.removed.includes(place.path),
  );
  const defaultPaths = new Set(defaults.map((place) => place.path));
  const rows = [
    ...shown,
    ...places.added
      .filter((path) => !defaultPaths.has(path))
      .map((path) => placeOf(path)),
  ];
  const rank = (place: Place) => {
    const at = places.order.indexOf(place.path);
    return at === -1 ? places.order.length : at;
  };
  return rows.toSorted((a, b) => rank(a) - rank(b));
}

/**
 * The folder Files opens at when it is not opened at one of its own: the
 * first row under Favorites, so moving a folder to the top of Favorites picks it.
 * A folder of apps is passed over, since a stock Mac's sidebar, which the
 * first launch adopts, puts Applications first. Nothing when nothing else is
 * added. `defaults` are the computer's places, the Instrument folder among
 * them, which stands above Favorites rather than in it.
 */
export function firstFavoriteFolder(
  defaults: readonly { kind: string; path: string }[],
  places: FavoriteChanges,
): string | undefined {
  const home = defaults.find((place) => place.kind === "home")?.path;
  const appFolders = new Set([
    "/Applications",
    "/System/Applications",
    ...(home === undefined ? [] : [`${home}/Applications`]),
  ]);
  return favoritePlaces(
    defaults.filter((place) => place.kind !== "output"),
    places,
    (path) => ({ kind: "folder", path }),
  ).find((place) => !appFolders.has(place.path))?.path;
}

/**
 * The sidebar made to show what the system's own file manager pins (`system`,
 * in its order): each of those folders added, and each default it leaves out
 * removed, and the rows put in its order. What the person already added
 * stays, after those rows.
 */
export function adoptSystemSidebar(
  places: FavoriteChanges,
  system: readonly string[],
  defaults: readonly string[],
): FavoriteChanges {
  const adopted = system.reduce(
    (added, path) => addFavorite(added, path),
    places,
  );
  return {
    ...defaults
      .filter((path) => !system.includes(path) && !places.added.includes(path))
      .reduce(removeFavorite, adopted),
    order: [...system],
  };
}
