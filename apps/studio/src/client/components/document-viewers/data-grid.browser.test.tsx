import { renderInBrowser } from "@/tests/render-browser";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import "../../styles/globals.css";
import { type CellValue, DataGrid, type GridColumn } from "./data-grid";

const columns: GridColumn[] = [
  { name: "name" },
  { align: "right", name: "count" },
];

// The first row's count is blank, so a column whose first value is missing is
// still sorted and searched like any other.
const rows: CellValue[][] = [
  ["pear", null],
  ["apple", "10"],
  ["fig", "9"],
  ["kiwi", "120"],
];

/**
 * The grid in a box the size of a viewer, since both virtualizers draw only
 * what fits in their scroll element.
 */
async function renderGrid() {
  return renderInBrowser(
    <div className="flex h-96 w-[48rem] flex-col">
      <DataGrid columns={columns} rows={rows} />
    </div>,
  );
}

/** The cells of one column, top to bottom, as drawn. */
function columnText(index: number) {
  return [...document.querySelectorAll('[role="row"]')]
    .slice(1)
    .map(
      (row) => row.querySelectorAll('[role="gridcell"]')[index]?.textContent,
    );
}

function header(name: string) {
  const found = [...document.querySelectorAll('[role="columnheader"]')].find(
    (cell) => cell.textContent === name,
  );
  if (!(found instanceof HTMLElement)) {
    throw new Error(`No header named ${name}`);
  }
  return found;
}

it("sorts a column by number, keeping blanks last both ways", async () => {
  await renderGrid();

  await userEvent.click(page.getByRole("button", { name: "count" }));
  await expect.poll(() => columnText(1)).toEqual(["9", "10", "120", "NULL"]);
  expect(header("count").querySelector("svg")).not.toBeNull();

  await userEvent.click(page.getByRole("button", { name: "count" }));
  await expect.poll(() => columnText(1)).toEqual(["120", "10", "9", "NULL"]);
});

it("filters rows across every column", async () => {
  await renderGrid();

  await userEvent.fill(
    page.getByRole("textbox", { name: "Filter rows" }),
    "12",
  );
  await expect.poll(() => columnText(0)).toEqual(["kiwi"]);
  await expect.element(page.getByText("1 of 4 rows")).toBeVisible();
});

it("hides a column from the column menu and shows it unchecked", async () => {
  await renderGrid();

  await userEvent.click(page.getByRole("button", { name: "Columns" }));
  const count = page.getByRole("menuitemcheckbox", { name: "count" });
  await expect.element(count).toHaveAttribute("aria-checked", "true");
  await userEvent.click(count);

  await expect.element(count).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(() => document.querySelectorAll('[role="columnheader"]').length)
    .toBe(1);
});

it("resizes a column by dragging its header's edge", async () => {
  await renderGrid();

  const cell = header("name");
  const before = cell.getBoundingClientRect().width;
  const handle = cell.lastElementChild;
  if (!(handle instanceof HTMLElement)) {
    throw new Error("No resize handle");
  }
  const { right, top } = handle.getBoundingClientRect();
  handle.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      clientX: right,
      clientY: top,
    }),
  );
  document.dispatchEvent(
    new MouseEvent("mousemove", { bubbles: true, clientX: right + 60 }),
  );
  document.dispatchEvent(
    new MouseEvent("mouseup", { bubbles: true, clientX: right + 60 }),
  );

  await expect
    .poll(() => header("name").getBoundingClientRect().width)
    .toBeCloseTo(before + 60, 0);
});
