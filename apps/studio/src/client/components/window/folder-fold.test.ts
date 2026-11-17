import { describe, expect, it } from "vitest";

import {
  type FolderFold,
  foldToWidth,
  hideFolder,
  KEPT_FOLDER,
  showsFolder,
  toggleFolder,
} from "./folder-fold";

/** A tab with room for the folder beside the file from 720 px on. */
const hasRoomAt = (width: number) => width >= 720;

type Step = number | "toggle" | "hide";

/** Whether the folder shows after each step, from a file just opened in a tab `start` wide. */
function walk(start: number, steps: Step[]) {
  let fold: FolderFold = foldToWidth(KEPT_FOLDER, start, hasRoomAt);
  const shown = [showsFolder(fold)];
  for (const step of steps) {
    fold =
      step === "toggle"
        ? toggleFolder(fold)
        : step === "hide"
          ? hideFolder(fold)
          : foldToWidth(fold, step, hasRoomAt);
    shown.push(showsFolder(fold));
  }
  return shown;
}

describe("folder fold", () => {
  it.each([
    { shown: true, width: 720 },
    { shown: false, width: 719 },
  ])("opens a file beside the folder at $width px: $shown", (each) => {
    expect(walk(each.width, [])).toEqual([each.shown]);
  });

  it("folds under the line and comes back past the margin", () => {
    expect(walk(900, [719, 740, 759, 760, 720, 719])).toEqual([
      true,
      false,
      false,
      false,
      true,
      true,
      false,
    ]);
  });

  it("keeps a folder hidden by hand hidden at every width", () => {
    expect(walk(900, ["toggle", 600, 1200, 2000])).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("shows a folder shown by hand without room until the width crosses the line", () => {
    // Shown at 600, narrower still keeps it; past the margin it is the width's
    // again, so the next fold takes it.
    expect(walk(600, ["toggle", 500, 700, 760, 719])).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("keeps a folder hidden again after a show by hand hidden as the tab widens", () => {
    expect(walk(600, ["toggle", "toggle", 900])).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  it("returns the same fold for the same verdict", () => {
    const fold = foldToWidth(KEPT_FOLDER, 900, hasRoomAt);
    expect(foldToWidth(fold, 800, hasRoomAt)).toBe(fold);
    const folded = foldToWidth(fold, 700, hasRoomAt);
    expect(foldToWidth(folded, 750, hasRoomAt)).toBe(folded);
  });

  it("keeps a folder dragged shut hidden as the tab widens", () => {
    expect(walk(900, ["hide", 1200])).toEqual([true, false, false]);
  });
});
