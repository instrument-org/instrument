import { type Rect, type SideZone } from "./landing";
import { type Held, type Landing } from "./types";

/**
 * What a side's page has under the pointer that takes a drop itself, as the
 * window reads it there:
 *
 * - `box`: a box a message is written in (`data-file-drop-region`), which
 *   attaches files and takes a link's words;
 * - `text`: any other field that takes words, which takes a link;
 * - `folder`: a folder in Files, which takes files over the whole page;
 * - `place`: a folder in Files while a place of its sidebar is held, which
 *   it never takes;
 * - `over`: something standing over the page there, as a dialog does, or a
 *   page in a frame of its own, which hears the drag itself;
 * - nothing for the page's own ground.
 */
export type UnderPoint = "box" | "folder" | "over" | "place" | "text";

/** What a side shows up: a web page, which takes content itself; a new tab nobody has written in; anything else. */
export type SideShows = "newTab" | "other" | "site";

/**
 * Where something held over a side's page lands, or "native" where the
 * page takes it itself through the system's drag, or nothing. The one rule
 * for every target over a page, in precedence order:
 *
 * 1. A split target at a lone side's end, drawn over the page, makes a side.
 * 2. Content (files or a link held by the system's drag) goes to whatever
 *    in the page takes it: a box, a field, a web page, a folder, or
 *    anything standing over the page.
 * 3. A new tab nobody has written in turns into files or a link.
 * 4. Anything else joins the side it is held over, as a tab does.
 *
 * A piece of the window (a tab, a group, a bookmark) skips step 2: it is
 * never handed to a page.
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
  if (zone?.kind === "split") {
    return { group, kind: "side", lit: zone.lit, side: zone.side, split: true };
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
  return zone
    ? { group, kind: "side", lit: zone.lit, side: zone.side, split: false }
    : undefined;
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
