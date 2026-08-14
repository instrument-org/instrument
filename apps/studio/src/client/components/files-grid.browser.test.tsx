import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { renderInBrowser } from "@/tests/render-browser";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { expect, test } from "vitest";

import { FilesGrid } from "./files-grid";
import { FILE_ITEM_SELECTOR } from "./files-grid-collapse";

/**
 * What the collapsed grid cuts, and whether the button under it says so.
 *
 * The claim the count makes is a claim about layout: "3 more" means three files
 * you cannot see all of, and how many that is depends on how the sections
 * wrapped, which jsdom has no opinion about. So every assertion here reads the
 * cut off the boxes themselves and compares it against what the button offers,
 * rather than against a number this file also picked.
 */

const TASK_ID = TaskIdSchema.parse("quarterly-numbers");

async function drawGrid(
  files: TaskFileViewerFile[],
  { compact = false, width = 640 } = {},
) {
  const rendered = await renderInBrowser(
    <div data-column style={{ width }}>
      <FilesGrid compact={compact} files={files} preserveOrder />
    </div>,
  );

  const column = rendered.container.querySelector<HTMLElement>("[data-column]");
  const clip = rendered.container.querySelector<HTMLElement>(
    "[style*='max-height']",
  );

  return {
    ...rendered,
    /** The height the clamp settled on, or none if the grid was left whole. */
    clampedTo: () => clip?.style.maxHeight || "none",
    /**
     * The files the clip box does not show whole, read off the rendered boxes.
     * Rects rather than the component's own offsets, so this is an independent
     * reading of the same cut -- the browser project pins zoom at 1x, where the
     * two agree.
     */
    cutFiles: () => {
      if (!clip) {
        return 0;
      }
      const bottom = clip.getBoundingClientRect().bottom;
      return [
        ...clip.querySelectorAll<HTMLElement>(
          "[data-slot='files-grid-item']:not([data-pending])",
        ),
      ].filter((item) => item.getBoundingClientRect().bottom > bottom + 0.5)
        .length;
    },
    /** The number the button offers to show; none drawn is none offered. */
    offered: () => {
      for (const button of rendered.container.querySelectorAll("button")) {
        const match = /^Show (?<count>\d+) more$/u.exec(button.textContent);
        if (match) {
          return Number(match.groups?.count);
        }
      }
      return 0;
    },
    /** Grows one file's box in place, the way a taller card would. */
    growItem: (index: number, height: number) => {
      const item =
        clip?.querySelectorAll<HTMLElement>(FILE_ITEM_SELECTOR)[index];
      if (item) {
        item.style.height = `${height}px`;
      }
    },
    /** The button inside the last file box the grid drew. */
    lastItemControl: () =>
      clip?.querySelector<HTMLElement>(
        `${FILE_ITEM_SELECTOR}:last-of-type button`,
      ),
    /** Resizes the column in place, the way a splitter drag would. */
    setWidth: (next: number) => {
      if (column) {
        column.style.width = `${next}px`;
      }
    },
  };
}

function filesNamed(names: string[]): TaskFileViewerFile[] {
  return names.map((filename) => ({
    filename,
    filePath: `output/${filename}`,
    taskId: TASK_ID,
    url: `http://assets.example.test/output/${filename}`,
  }));
}

function numbered(count: number, extension: string) {
  return filesNamed(
    Array.from({ length: count }, (_, index) => `file-${index}.${extension}`),
  );
}

test("offers exactly the files it cuts, at whatever width they wrapped to", async () => {
  // The same set of files at three widths. A count-based cut drew the same
  // number of files at all three and hid a different number of them; what makes
  // the offer honest is that it moves with the wrap.
  const files = numbered(40, "md");

  const counts = [];
  for (const width of [360, 640, 900]) {
    const grid = await drawGrid(files, { compact: true, width });
    expect(grid.offered()).toBe(grid.cutFiles());
    counts.push(grid.offered());
  }

  // Wider columns fit more per row, so fewer files fall past the clamp.
  expect(counts).toMatchInlineSnapshot(`
    [
      34,
      30,
      25,
    ]
  `);
});

test("shows a lone file whole, however tall its card is", async () => {
  // A single image takes two thirds of the column as a square, which is taller
  // than the clamp on its own. The first row is never what gets cut, so there is
  // nothing to offer.
  const grid = await drawGrid(filesNamed(["chart.png"]));

  expect(grid.cutFiles()).toBe(0);
  expect(grid.offered()).toBe(0);
});

test("leaves nothing cut once expanded", async () => {
  const grid = await drawGrid(numbered(40, "md"), {
    compact: true,
    width: 360,
  });

  await grid.getByRole("button", { name: /Show \d+ more/u }).click();

  expect(grid.cutFiles()).toBe(0);
  await expect
    .element(grid.getByRole("button", { name: "Show less" }))
    .toBeVisible();
});

test("says nothing about more files when the grid holds them all", async () => {
  const grid = await drawGrid(numbered(3, "md"), { compact: true });

  expect(grid.cutFiles()).toBe(0);
  expect(grid.offered()).toBe(0);
});

test("re-counts when its column is widened under it", async () => {
  // The same grid resized in place, rather than two grids mounted at two
  // widths: a splitter drag and an app-zoom change both arrive this way, as a
  // width the component was not re-rendered for.
  const grid = await drawGrid(numbered(40, "md"), {
    compact: true,
    width: 360,
  });
  const narrow = grid.offered();

  grid.setWidth(900);

  await expect.poll(() => grid.offered()).toBeLessThan(narrow);
  expect(grid.offered()).toBe(grid.cutFiles());
});

test("keeps a row of media whole and clamps below it", async () => {
  // Nine images: one row of three at this width, which is already taller than
  // the clamp's own height. The clamp grows to hold that row and cuts under it,
  // so the second row shows as a dissolving sliver and everything past the first
  // row is what the button offers.
  const grid = await drawGrid(numbered(9, "png"), { width: 640 });

  expect({
    clampedTo: grid.clampedTo(),
    cut: grid.cutFiles(),
    offered: grid.offered(),
  }).toMatchInlineSnapshot(`
    {
      "clampedTo": "248px",
      "cut": 6,
      "offered": 6,
    }
  `);
});

test("re-counts when a card grows inside a clamp that is already pinned", async () => {
  // What the observer has to watch is the unclamped box. While collapsed the
  // clip box is pinned to the clamp, so a card growing inside it pushes files
  // past the fade without changing anything a ResizeObserver on the clip could
  // see -- and the file count, which is the other thing that would notice, has
  // not changed either.
  const grid = await drawGrid(numbered(32, "md"), {
    compact: true,
    width: 900,
  });
  const before = grid.offered();
  expect(before).toBe(grid.cutFiles());

  // A file on the second row, which is on screen until it is this tall.
  grid.growItem(9, 200);

  await expect.poll(() => grid.offered()).toBe(before + 1);
  expect(grid.offered()).toBe(grid.cutFiles());
});

test("opens itself when focus reaches a file it cut", async () => {
  // Tabbing into a clipped card would otherwise put the focus ring somewhere
  // nobody can see it, and the box it sits in cannot scroll.
  const grid = await drawGrid(numbered(40, "md"), {
    compact: true,
    width: 360,
  });
  expect(grid.cutFiles()).toBeGreaterThan(0);

  grid.lastItemControl()?.focus();

  await expect.poll(() => grid.cutFiles()).toBe(0);
  await expect
    .element(grid.getByRole("button", { name: "Show less" }))
    .toBeVisible();
});
