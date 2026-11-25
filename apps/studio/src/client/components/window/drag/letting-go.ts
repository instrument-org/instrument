import {
  isBookmark,
  type Held,
  type Landing,
  opensAsBookmark,
  placeOf,
} from "./types";

/**
 * What letting go of what is held does where it would land, and the line
 * said under it while it is held there: one answer for every pair of what
 * can be held and where it can land, which the lander acts on and the drag
 * layer says. Each line says what opens or moves, and where, in the words a
 * person would use: a group by its name, left and right for halves.
 *
 * - `move`: a tab or a whole group goes there, as itself.
 * - `open`: a link or files open there as the tabs their addresses name.
 * - `keep`: kept on the bookmarks bar.
 * - `favorite`: a folder or a place stands among Favorites' rows there.
 * - `into`: files go into the folder of a row of Favorites.
 * - `unfavorite`: a place of Favorites let go where nothing takes it, in the window
 *   or past it, leaves Favorites, as Finder's sidebar lets go of one.
 * - `attach`: a place goes with the message in a composer's box, as its
 *   folder dragged from Files' listing does.
 *
 * Let go where nothing takes it, a bookmark stays where it is kept, as in a
 * browser's bar.
 *
 * A bookmark, a shortcut at the bar's start or a place held is a piece of
 * the window, as a tab is, which no page's content takes: a bookmark or a
 * shortcut opens as a tab from a strip or a
 * page's outer edge, and a place from a strip alone.
 *
 * No line where what is held already stands where it would go: its own
 * strip, a whole group's room in the list.
 */
export type Outcome =
  | {
      does:
        | "attach"
        | "into"
        | "keep"
        | "move"
        | "open"
        | "favorite"
        | "unfavorite";
      line: string | undefined;
    }
  | { does: "nothing"; line: undefined };

export function outcomeOf(
  held: Held,
  landing: Landing | undefined,
  {
    groupTitle = () => undefined,
    tabCount = 1,
  }: {
    /** A group's name, which the line names it by. */
    groupTitle?: (group: string) => string | undefined;
    /** How many tabs a whole group held brings, said where it goes to a strip. */
    tabCount?: number;
  } = {},
): Outcome {
  const isOwnTab = held.kind === "tab" || held.kind === "group";
  // A bookmark, a shortcut or a place held by the pointer, a link that is a
  // piece of the window, which a page's content never takes.
  const isPiece = opensAsBookmark(held) || placeOf(held) !== undefined;
  const goes = (line: string | undefined): Outcome => ({
    does: isOwnTab ? "move" : "open",
    line,
  });
  const nothing: Outcome = { does: "nothing", line: undefined };
  if (!landing) {
    return nothing;
  }
  switch (landing.kind) {
    case "bookmarks": {
      return {
        does: "keep",
        line:
          isBookmark(held) || held.kind === "folder"
            ? "Move here"
            : "Add to bookmarks",
      };
    }
    case "strip": {
      // Its own tab stands in the strip itself; anything from elsewhere
      // goes to the line.
      if (landing.line === undefined) {
        return goes(undefined);
      }
      if (held.kind === "group") {
        return goes(
          `Move ${String(tabCount)} ${tabCount === 1 ? "tab" : "tabs"} here`,
        );
      }
      return goes(held.kind === "tab" ? "Move here" : "Open in a new tab");
    }
    case "replace":
    case "newTab": {
      // Only content opens in a tab's place; a tab never replaces another,
      // and a new tab's page takes no bookmark or place, as no page does.
      return isOwnTab || (landing.kind === "newTab" && isPiece)
        ? nothing
        : goes("Open in this tab");
    }
    case "side": {
      // A place opens as a tab from a strip alone, and a bookmark or a
      // shortcut from a strip or a page's outer edge.
      if (placeOf(held) || (opensAsBookmark(held) && !landing.edge)) {
        return nothing;
      }
      if (landing.isLone) {
        // Only content opens as a new tab of a page it is let go on.
        return isOwnTab ? nothing : goes("Open in a new tab");
      }
      const where = landing.side === 0 ? "the left" : "the right";
      return goes(
        held.kind === "tab" ? `Move to ${where}` : `Open on ${where}`,
      );
    }
    case "sidebar": {
      if (held.kind === "group") {
        // A whole group takes a room in the list, standing there itself.
        return landing.drop.kind === "between" ? goes(undefined) : nothing;
      }
      if (landing.drop.kind === "between") {
        return goes("New tab group");
      }
      const title = groupTitle(landing.drop.group);
      return goes(
        held.kind === "tab"
          ? title
            ? `Move to ${title}`
            : "Move to this group"
          : title
            ? `Add to ${title}`
            : "Add to this group",
      );
    }
    case "favorite": {
      return {
        does: "favorite",
        line: landing.moves ? "Move here" : "Add to Favorites",
      };
    }
    case "into": {
      return {
        does: "into",
        line: `${landing.copies ? "Copy" : "Move"} into ${landing.name}`,
      };
    }
    case "unfavorite": {
      return placeOf(held)?.favorites
        ? { does: "unfavorite", line: "Remove from Favorites" }
        : nothing;
    }
    case "attach": {
      // The box says it in its own outline.
      return placeOf(held) ? { does: "attach", line: undefined } : nothing;
    }
    case "window": {
      return goes("Open in a new window");
    }
  }
}
