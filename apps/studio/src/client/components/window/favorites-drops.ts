import { isOwnFileDragOf } from "@/client/lib/self-file-drag";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import { type Point, type Rect } from "./drag/landing";
import { dragAtom, useDropTarget } from "./drag/session";
import { type DroppedFile, type Held, type Landing } from "./drag/types";
import { folderOf, isInside } from "./host-path";
import { SPRING_FLASH_MS, springTimer } from "./spring-loading";

/** A row of Files' Favorites as a drop reads it: its folder, its name and where it is drawn, in the window's px. */
export interface FavoriteRow {
  name: string;
  path: string;
  rect: Rect;
}

/** How far above the first row and below the last Favorites still takes a drop, for the line at either end. */
const LIST_REACH_PX = 6;

/** The share of a row, at its top and at its bottom, where a folder held goes between rows rather than into the row's folder. */
const ROW_EDGE_SHARE = 0.25;

/** How far in from the rows' sides the line between them stands, and how thick it is. */
const LINE_INSET_PX = 6;
const LINE_PX = 2;

/** The Favorites rows' paths with `moving` standing at `gap`, among the rest as they stand. */
export function favoritesOrder(
  rows: readonly string[],
  moving: readonly string[],
  gap: number,
): string[] {
  const before = rows.slice(0, gap).filter((path) => !moving.includes(path));
  const after = rows.slice(gap).filter((path) => !moving.includes(path));
  return [...before, ...moving, ...after];
}

/** The gap among rows nearest a height: before the first row whose middle is below it. */
function gapAt(rows: readonly FavoriteRow[], y: number) {
  const below = rows.findIndex((row) => y < row.rect.top + row.rect.height / 2);
  return below === -1 ? rows.length : below;
}

/** The line in a gap among rows, in the window's px. */
function lineAt(rows: readonly FavoriteRow[], gap: number): Rect | undefined {
  const above = rows[gap - 1]?.rect;
  const below = rows[gap]?.rect;
  const row = below ?? above;
  if (!row) {
    return undefined;
  }
  const y =
    above && below
      ? (above.top + above.height + below.top) / 2
      : below
        ? below.top - 1
        : row.top + row.height + 1;
  return {
    height: LINE_PX,
    left: row.left + LINE_INSET_PX,
    top: y - LINE_PX / 2,
    width: row.width - LINE_INSET_PX * 2,
  };
}

/** Whether a file or folder going into a folder goes nowhere: it is in it already, or is it, or holds it. */
function goesNowhere(file: DroppedFile, folder: string) {
  return folderOf(file.hostPath) === folder || isInside(folder, file.hostPath);
}

/**
 * Where something held over Files' Favorites lands, the rows standing still
 * under it, as in Finder's sidebar:
 *
 * - A place of the sidebar or the Files menu stands at the line between
 *   rows nearest the pointer, which adds it there or moves its row there.
 * - Folders held from Files or elsewhere stand at that line too, added
 *   there, near a row's top or bottom; anywhere else on a row, files and
 *   folders go into its folder, moved where Files' own rows are held and
 *   copied from elsewhere.
 * - "refused" where letting go would change nothing (the files are in that
 *   folder already, or the row would stand where it stands), or where what
 *   is held is not known yet; nothing for anything else held, which the
 *   page under Favorites answers for.
 */
export function favoritesLandingAt({
  held,
  point,
  rows,
}: {
  held: Held;
  point: Point;
  rows: readonly FavoriteRow[];
}): Landing | "refused" | undefined {
  const paths = rows.map((row) => row.path);
  const favoriteAt = (moving: readonly string[]): Landing | "refused" => {
    const gap = gapAt(rows, point.y);
    const line = lineAt(rows, gap);
    const order = favoritesOrder(paths, moving, gap);
    if (!line || order.join("\n") === paths.join("\n")) {
      return "refused";
    }
    return {
      index: gap,
      kind: "favorite",
      line,
      moves: moving.every((path) => paths.includes(path)),
    };
  };
  if (held.kind === "link" && held.place) {
    return favoriteAt([held.place.path]);
  }
  if (held.kind !== "files") {
    return undefined;
  }
  const { files } = held;
  if (!files || files.length === 0) {
    return "refused";
  }
  const row = rows.find(
    ({ rect }) => point.y >= rect.top && point.y < rect.top + rect.height,
  );
  const isFolders = files.every((file) => file.isFolder);
  const nearEdge =
    row !== undefined &&
    Math.min(point.y - row.rect.top, row.rect.top + row.rect.height - point.y) <
      row.rect.height * ROW_EDGE_SHARE;
  if (isFolders && (!row || nearEdge)) {
    return favoriteAt(files.map((file) => file.hostPath));
  }
  if (!row || files.some((file) => goesNowhere(file, row.path))) {
    return "refused";
  }
  return {
    copies: !isOwnFileDragOf(files.map((file) => file.hostPath)),
    folder: row.path,
    kind: "into",
    lit: row.rect,
    name: row.name,
  };
}

/** Whether the ring of the row a drag rests on is out for a moment before its folder opens. */
export const springFlashAtom = atom(false);

/**
 * Files' Favorites as a place to land (`favoritesLandingAt`), its rows marked
 * `data-favorite-place` with their folder's path, and `data-favorite-name`
 * with their name, in `list`. Lands what it
 * takes itself: a place or folders added among the rows, files moved or
 * copied into a row's folder. Files resting on a row open its folder in
 * the Files view under the sidebar after a moment, as Finder springs a
 * folder open, so the drag goes on into it; the view goes back to where it
 * was once the drag ends anywhere but in it.
 */
export function useFavoritesTarget({
  list,
  onInto,
  onFavorite,
  onSpring,
  springs,
}: {
  list: () => HTMLElement | null;
  onInto: (
    files: readonly DroppedFile[],
    folder: string,
    how: { copies: boolean },
  ) => void;
  onFavorite: (paths: readonly string[], order: readonly string[]) => void;
  /** Opens a folder in the view under the drag, or (`undefined`) puts the view back where it was. */
  onSpring: (folder: string | undefined) => void;
  /** Whether a row's folder may open under a drag resting on it. */
  springs: (folder: string) => boolean;
}) {
  const rowsOf = (): FavoriteRow[] => {
    const element = list();
    if (!element) {
      return [];
    }
    return [
      ...element.querySelectorAll<HTMLElement>("[data-favorite-place]"),
    ].flatMap((row) => {
      const { height, left, top, width } = row.getBoundingClientRect();
      const path = row.dataset.favoritePlace;
      return path && height > 0
        ? [
            {
              name: row.dataset.favoriteName ?? path,
              path,
              rect: { height, left, top, width },
            },
          ]
        : [];
    });
  };
  useDropTarget({
    land: (held, landing) => {
      const rows = rowsOf().map((row) => row.path);
      if (landing.kind === "favorite") {
        const moving =
          held.kind === "link" && held.place
            ? [held.place.path]
            : held.kind === "files"
              ? (held.files ?? []).map((file) => file.hostPath)
              : [];
        if (moving.length > 0) {
          onFavorite(moving, favoritesOrder(rows, moving, landing.index));
        }
      } else if (landing.kind === "into" && held.kind === "files") {
        onInto(held.files ?? [], landing.folder, { copies: landing.copies });
      }
    },
    landingAt: (point, { held }) =>
      favoritesLandingAt({ held, point, rows: rowsOf() }),
    rect: () => {
      const element = list();
      if (!element?.checkVisibility()) {
        return undefined;
      }
      const { height, left, top, width } = element.getBoundingClientRect();
      return height > 0
        ? {
            height: height + LIST_REACH_PX * 2,
            left,
            top: top - LIST_REACH_PX,
            width,
          }
        : undefined;
    },
  });
  useSpringOnRest({ onSpring, springs });
}

/** Opens the folder of the row a drag rests on, after a moment, and puts the view back once the drag ends elsewhere. */
function useSpringOnRest({
  onSpring,
  springs,
}: {
  onSpring: (folder: string | undefined) => void;
  springs: (folder: string) => boolean;
}) {
  const drag = useAtomValue(dragAtom);
  const latest = useRef({ onSpring, springs });
  useEffect(() => {
    latest.current = { onSpring, springs };
  });
  const timer = useRef<ReturnType<typeof springTimer>>(undefined);
  const hasSprung = useRef(false);
  useEffect(
    () => () => {
      timer.current?.stop();
    },
    [],
  );
  const landing = drag?.landing;
  const resting =
    landing?.kind === "into" && springs(landing.folder) ? landing.folder : null;
  const isDragging = drag !== undefined;
  useEffect(() => {
    const store = getDefaultStore();
    if (timer.current === undefined) {
      timer.current = springTimer(
        (folder) => {
          hasSprung.current = true;
          latest.current.onSpring(folder);
        },
        {
          flash: () => {
            store.set(springFlashAtom, true);
            window.setTimeout(() => {
              store.set(springFlashAtom, false);
            }, SPRING_FLASH_MS);
          },
        },
      );
    }
    timer.current.rest(resting);
  }, [resting]);
  useEffect(() => {
    if (isDragging || !hasSprung.current) {
      return;
    }
    hasSprung.current = false;
    timer.current?.stop();
    // After the drop has gone to whatever took it: dropped in the view
    // opened under it, the view keeps it, and putting it back is then
    // nothing.
    const back = window.setTimeout(() => {
      latest.current.onSpring(undefined);
    }, 0);
    return () => {
      window.clearTimeout(back);
    };
  }, [isDragging]);
}
