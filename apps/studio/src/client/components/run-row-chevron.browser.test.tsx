import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it } from "vitest";

import { TRANSCRIPT_ROW } from "./message-part/transcript-group";
import { RunRowChevron } from "./run-row-chevron";

// A row of the shape the transcript builds: a label, and the chevron closing it
// out. The width is what makes the row's own right edge measurable, which is the
// edge the pointer has to be able to sit on.
const renderRow = (isOpen: boolean) =>
  renderInBrowser(
    <div style={{ width: 480 }}>
      <button className={TRANSCRIPT_ROW} type="button">
        <span className="min-w-0 truncate text-sm">Ran a command</span>
        <RunRowChevron isOpen={isOpen} />
      </button>
    </div>,
  );

const rowAndChevron = (root: Element) => {
  const row = root.querySelector("button");
  const chevron = root.querySelector("svg");
  if (!row || !chevron) {
    throw new Error("no row rendered");
  }
  return {
    chevron: chevron.getBoundingClientRect(),
    row: row.getBoundingClientRect(),
  };
};

describe("RunRowChevron", () => {
  // Taken out of the layout, the row's box ended at the label and the chevron
  // appeared beyond it: the pointer reaching for the chevron sat on the row's
  // own edge, and stepping off took the chevron away, narrowed the row, and put
  // the pointer further outside it still. It has to hold its place.
  it("sits inside the row that reveals it", async () => {
    const screen = await renderRow(false);
    const { chevron, row } = rowAndChevron(screen.container);

    expect(chevron.width).toBeGreaterThan(0);
    expect(chevron.right).toBeLessThanOrEqual(row.right);
    expect(chevron.left).toBeGreaterThanOrEqual(row.left);
  });

  it("is the same row whether it is open or closed", async () => {
    const closedScreen = await renderRow(false);
    const openScreen = await renderRow(true);
    const closed = rowAndChevron(closedScreen.container);
    const open = rowAndChevron(openScreen.container);

    expect(closed.row.width).toBe(open.row.width);
    expect(closed.chevron.left).toBe(open.chevron.left);
  });

  // Quiet at rest is the point of it; what changed is that being quiet no longer
  // means being absent.
  it("is drawn but invisible until the row is hovered", async () => {
    const screen = await renderRow(false);
    const chevron = screen.container.querySelector("svg");
    if (!chevron) {
      throw new Error("no chevron rendered");
    }

    const style = globalThis.getComputedStyle(chevron);
    expect(style.opacity).toBe("0");
    expect(style.display).not.toBe("none");
  });
});
