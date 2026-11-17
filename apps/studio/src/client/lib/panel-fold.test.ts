import { describe, expect, it } from "vitest";

import {
  foldToWidth,
  hidePanel,
  KEPT_PANEL,
  type PanelFold,
  showsPanel,
  togglePanel,
} from "./panel-fold";

/** A layout with room for the panel from 720 px on. */
const hasRoomAt = (width: number) => width >= 720;

type Step = number | "toggle" | "hide";

/** Whether the panel shows after each step, from one just opened in a layout `start` wide. */
function walk(start: number, steps: Step[]) {
  let fold: PanelFold = foldToWidth(KEPT_PANEL, start, hasRoomAt);
  const shown = [showsPanel(fold)];
  for (const step of steps) {
    fold =
      step === "toggle"
        ? togglePanel(fold)
        : step === "hide"
          ? hidePanel(fold)
          : foldToWidth(fold, step, hasRoomAt);
    shown.push(showsPanel(fold));
  }
  return shown;
}

describe("panel fold", () => {
  it.each([
    { shown: true, width: 720 },
    { shown: false, width: 719 },
  ])("opens at $width px shown: $shown", (each) => {
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

  it("keeps a panel put away by hand hidden at every width", () => {
    expect(walk(900, ["toggle", 600, 1200, 2000])).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("shows a panel shown by hand without room until the width crosses the line", () => {
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

  it("keeps a panel put away after a show by hand hidden as the layout widens", () => {
    expect(walk(600, ["toggle", "toggle", 900])).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  it("returns the same fold for the same verdict", () => {
    const fold = foldToWidth(KEPT_PANEL, 900, hasRoomAt);
    expect(foldToWidth(fold, 800, hasRoomAt)).toBe(fold);
    const folded = foldToWidth(fold, 700, hasRoomAt);
    expect(foldToWidth(folded, 750, hasRoomAt)).toBe(folded);
  });

  it("keeps a panel dragged shut hidden as the layout widens", () => {
    expect(walk(900, ["hide", 1200])).toEqual([true, false, false]);
  });
});
