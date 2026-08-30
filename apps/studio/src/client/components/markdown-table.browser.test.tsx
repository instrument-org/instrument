import { renderInBrowser } from "@/tests/render-browser";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";

import { MarkdownTable } from "./markdown-table";

/**
 * Reaching the row copy when it stands beside the table.
 *
 * The control sits past the table's edge in a wide transcript, and the way it
 * stays reachable is that the gap between edge and control belongs to the
 * control itself. Whether it does is a question about hit-testing: which
 * element a pointer sample in that gap lands on, and so whether crossing it
 * fires the row's `mouseleave` and hides the control mid-reach. jsdom has no
 * hit-testing, so this lives here.
 */

/** A transcript with room beside the text column, the way a wide pane has. */
async function renderWideTranscript() {
  await renderInBrowser(
    <div
      className="[--transcript-room:880px]"
      data-transcript
      style={{ width: 880 }}
    >
      <div style={{ marginInline: "auto", width: 480 }}>
        <MarkdownTable>
          <thead>
            <tr>
              <th>Region</th>
              <th>Revenue</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>North</td>
              <td>1200</td>
            </tr>
            <tr>
              <td>South</td>
              <td>800</td>
            </tr>
          </tbody>
        </MarkdownTable>
      </div>
    </div>,
  );

  const chip = document.querySelector<HTMLElement>(".markdown-table-row-copy");
  const frame = document.querySelector<HTMLElement>(".markdown-table-frame");
  const row = document.querySelector<HTMLElement>(".markdown-table-row");
  if (!chip || !frame || !row) {
    throw new Error("the table block did not render");
  }
  return { chip, frame, row };
}

test("the row copy survives the pointer crossing the gap to reach it", async () => {
  const { chip, frame, row } = await renderWideTranscript();

  await page.getByText("North").hover();
  await expect.poll(() => chip.dataset.visible).toBe("");
  // Beside the table, not on it -- on top of it there is no gap and nothing
  // for this test to say.
  expect(chip.dataset.outside).toBe("");

  // One pointer sample in the gap, which is what a pointer moving at
  // deliberate speed delivers on its way to the control. A jump that clears
  // the gap between two samples never fires `mouseleave` and proves nothing.
  const cell = page.getByText("North").element().getBoundingClientRect();
  const table = frame.querySelector("table");
  if (!table) {
    throw new Error("the table did not render");
  }
  const tableRect = table.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  await userEvent.hover(row, {
    // `force`, because the point is past the row's own border box and a
    // hit-target check would refuse to hover the row there. The point is the
    // event's location; what receives it is whatever really is at it.
    force: true,
    position: {
      x: tableRect.right - rowRect.left + 4,
      y: cell.top + cell.height / 2 - rowRect.top,
    },
  });

  expect(chip.dataset.visible).toBe("");

  // And the click lands: the reach ends on the control, and the control
  // answers.
  await page.getByRole("button", { name: "Copy row" }).click();
  await expect
    .element(page.getByRole("menuitem", { name: "Copy row" }))
    .toBeVisible();
});
