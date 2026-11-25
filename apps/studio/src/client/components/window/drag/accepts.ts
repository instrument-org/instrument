import { type Rect, type SideZone } from "./landing";
import { type Held, type Landing, opensAsBookmark, placeOf } from "./types";

/**
 * What a side's page has under the pointer that takes a drop itself, as the
 * window reads it there:
 *
 * - `box`: a box a message is written in (`data-file-drop-region`), which
 *   attaches files and takes a link's words;
 * - `text`: any other field that takes words, which takes a link;
 * - `folder`: a folder in Files, which takes files over the whole page;
 * - `over`: something standing over the page there, as a dialog does, or a
 *   page in a frame of its own, which hears the drag itself;
 * - nothing for the page's own ground.
 */
export type UnderPoint = "box" | "folder" | "over" | "text";

/** What a side shows up: a web page, which takes content itself; a new tab nobody has written in; anything else. */
export type SideShows = "newTab" | "other" | "site";

/**
 * Where something held over a side's page lands, or "native" where the
 * page takes it itself through the system's drag, or nothing. The one rule
 * for every target over a page, in precedence order:
 *
 * 1. The group's outer edge (`sideZoneAt`'s `edge`) makes a side of a lone
 *    side's end, or joins the side there of two.
 * 2. Content (files or a link held by the system's drag) goes to whatever
 *    in the page takes it: a box, a field, a web page, a folder, or
 *    anything standing over the page.
 * 3. A new tab nobody has written in turns into files or a link.
 * 4. Anything else does what the side under the pointer does with it
 *    (`sideZoneAt`): content joins it, and a tab or a whole group lands
 *    nowhere.
 *
 * A piece of the window (a tab, a group, a bookmark, a shortcut at the
 * bar's start, a place) skips step 2: it is never handed to a page. A
 * bookmark or a shortcut stops after step 1, as a tab
 * does, so it opens as a tab only from a strip or an edge; a place lands
 * nowhere on a page, its edge included, and opens as a tab from a strip.
 */
export function pageLandingOf({
  group,
  held,
  input,
  page,
  shows,
  tab,
  under,
  zone,
}: {
  group: string;
  held: Held;
  input: "native" | "pointer" | "remote";
  /** The side's page under the point, as much of it as shows. */
  page: Rect | undefined;
  shows: SideShows;
  /** The tab up on the side, which a new tab is. */
  tab: string | undefined;
  under: UnderPoint | undefined;
  zone: SideZone | undefined;
}): Landing | "native" | undefined {
  const landingOf = (of: SideZone): Landing => ({
    ...(of.edge ? { edge: of.edge } : {}),
    group,
    ...(of.kind === "join" && of.isLone ? { isLone: true } : {}),
    kind: "side",
    lit: of.lit,
    side: of.side,
    split: of.kind === "split",
  });
  if (placeOf(held)) {
    return undefined;
  }
  if (zone?.edge) {
    return landingOf(zone);
  }
  if (opensAsBookmark(held)) {
    return undefined;
  }
  const isContent =
    input === "native" && (held.kind === "files" || held.kind === "link");
  if (isContent && takesItself(held.kind, shows, under)) {
    return "native";
  }
  if (
    shows === "newTab" &&
    page &&
    tab !== undefined &&
    (held.kind === "files" || held.kind === "link")
  ) {
    return { group, kind: "newTab", lit: page, tab };
  }
  return zone ? landingOf(zone) : undefined;
}

/** Whether the page under the point takes content of a kind itself. */
function takesItself(
  kind: "files" | "link",
  shows: SideShows,
  under: UnderPoint | undefined,
) {
  if (under === "box" || under === "over" || shows === "site") {
    return true;
  }
  return kind === "files" ? under === "folder" : under === "text";
}
