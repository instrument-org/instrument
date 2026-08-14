import { renderInBrowser } from "@/tests/render-browser";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { page, userEvent } from "vitest/browser";
import { expect, test, vi } from "vitest";

import { PaneTabs } from "./pane-tabs";

/**
 * How the strip gives things up as it fills, which jsdom cannot answer: with no
 * layout engine the strip is zero wide and every tab is at the same state for
 * the wrong reason.
 *
 * The strip does not scroll, so it compresses instead, and it compresses as one
 * thing: what is measured here is that a name never goes missing from one tab
 * while the tab beside it keeps its own, that the tab being read is the one
 * exception and is held wide enough to stay useful, that the close never ends
 * up drawn over the file icon, and that a strip too full to draw a tab whole
 * draws fewer tabs rather than a row of clipped icons.
 */

const taskId = TaskIdSchema.parse("pane-tabs-browser");

const FILES = [
  "output/quarterly-report-2026.pdf",
  "output/chart.png",
  "output/notes.md",
  "output/summary.docx",
  "output/data.csv",
  "output/screenshot-of-the-thing.png",
  "output/one-more.txt",
  "output/and-another.zip",
];

// The pane's own minimum, and a comfortable one, from `PANEL_SIZES`.
const NARROW = 300;
const WIDE = 500;

async function strip(
  fileCount: number,
  width: number,
  selectedKey = "file:output/chart.png",
  files = FILES,
) {
  const { container } = await renderInBrowser(
    <div style={{ width }}>
      <PaneTabs
        fileTabs={files.slice(0, fileCount).map((filePath) => ({
          filePath,
          type: "file" as const,
        }))}
        onClose={vi.fn()}
        onReorder={vi.fn()}
        onSelect={vi.fn()}
        // The selected tab is the one that draws its close unhovered, so it is
        // the one whose close can collide with anything.
        selectedKey={selectedKey}
        taskId={taskId}
      />
    </div>,
  );

  // The strip settles in a layout effect off a `ResizeObserver`, which delivers
  // before the frame is painted but after the render resolves. The app never
  // shows the state in between; a test that read here would.
  await new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });

  const list = container.querySelector<HTMLElement>('[role="tablist"]');
  const tabs = [...(list?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];

  return {
    density: list?.dataset.density,
    list,
    tabs,
    // The task's own tabs. The fixed one is not one of them: it takes no share
    // of the row and carries no close.
    fileTabs: tabs.filter((tab) => tab.title !== "Browser"),
  };
}

// What each tab the strip drew came out at, and what it had room to draw.
async function widths(fileCount: number, width: number) {
  const { tabs } = await strip(fileCount, width);

  return Object.fromEntries(
    tabs.map((tab) => [
      tab.title,
      `${tab.dataset.density ?? "unmeasured"} (${tab.offsetWidth}px)`,
    ]),
  );
}

test("compresses the row together, and holds the tab being read out of it", async () => {
  expect({
    six: { narrow: await widths(6, NARROW), wide: await widths(6, WIDE) },
    three: { narrow: await widths(3, NARROW), wide: await widths(3, WIDE) },
    two: { narrow: await widths(2, NARROW), wide: await widths(2, WIDE) },
  }).toMatchInlineSnapshot(`
    {
      "six": {
        "narrow": {
          "Browser": "icon (28px)",
          "chart.png": "icon (31px)",
          "data.csv": "icon (31px)",
          "notes.md": "icon (31px)",
          "quarterly-report-2026.pdf": "icon (31px)",
          "screenshot-of-the-thing.png": "icon (31px)",
          "summary.docx": "icon (31px)",
        },
        "wide": {
          "Browser": "icon (28px)",
          "chart.png": "full (80px)",
          "data.csv": "compact (61px)",
          "notes.md": "compact (61px)",
          "quarterly-report-2026.pdf": "compact (61px)",
          "screenshot-of-the-thing.png": "compact (61px)",
          "summary.docx": "compact (61px)",
        },
      },
      "three": {
        "narrow": {
          "Browser": "icon (28px)",
          "chart.png": "full (80px)",
          "notes.md": "icon (58px)",
          "quarterly-report-2026.pdf": "icon (58px)",
        },
        "wide": {
          "Browser": "full (86px)",
          "chart.png": "full (113px)",
          "notes.md": "full (113px)",
          "quarterly-report-2026.pdf": "full (113px)",
        },
      },
      "two": {
        "narrow": {
          "Browser": "icon (28px)",
          "chart.png": "full (100px)",
          "quarterly-report-2026.pdf": "full (100px)",
        },
        "wide": {
          "Browser": "full (86px)",
          "chart.png": "full (171px)",
          "quarterly-report-2026.pdf": "full (171px)",
        },
      },
    }
  `);
});

test("gives every tab the same width", async () => {
  // A row of tabs at different widths, every one of them truncated anyway, is a
  // row saying something about them that is not true -- and it leaves nothing
  // saying where one tab ends and the next begins. One width for all of them,
  // whatever each has to put in it.
  //
  // Read with the fixed tab selected, so none of the task's tabs is holding the
  // extra width the selected one gets.
  const distinctWidths = async (fileCount: number, width: number) => {
    const { fileTabs } = await strip(fileCount, width, "browser");
    return [...new Set(fileTabs.map((tab) => tab.offsetWidth))];
  };

  expect({
    six: await distinctWidths(6, WIDE),
    three: await distinctWidths(3, WIDE),
    twoNarrow: await distinctWidths(2, NARROW),
  }).toMatchInlineSnapshot(`
    {
      "six": [
        54,
      ],
      "three": [
        113,
      ],
      "twoNarrow": [
        71,
      ],
    }
  `);
});

test("draws fewer tabs rather than clipped ones", async () => {
  // A strip that kept dividing what it had would end in half-icons. Past the
  // point where another whole tab fits, the ones that fit are drawn and the
  // rest are not. So: no tab narrower than the icon it carries, and nothing
  // hanging off the end of a strip that clips what does.
  //
  // Read from layout rather than from the rendered boxes, which are transformed
  // while a tab is animating into a new position.
  const clipped: string[] = [];

  for (const fileCount of [1, 2, 3, 4, 6, 8]) {
    for (const width of [260, 300, 340, 380, 420, 460, 500, 620, 800]) {
      const { fileTabs, list } = await strip(fileCount, width);
      const narrow = fileTabs.filter((tab) => tab.offsetWidth < 28);
      if (narrow.length > 0 || (list && list.scrollWidth > list.clientWidth)) {
        clipped.push(
          `${fileCount} tabs at ${width}px: ${fileTabs.map((tab) => tab.offsetWidth).join("/")} in ${list?.clientWidth ?? 0}px`,
        );
      }
    }
  }

  expect(clipped).toEqual([]);
});

test("never draws the close over the file icon", async () => {
  // The close is positioned against the tab's right edge and the icon against
  // its left, so a compressing tab walks the two together. The state that drops
  // the close is what has to stop them meeting -- at every width, not just the
  // ones with a threshold on them.
  const overlaps: string[] = [];

  for (const fileCount of [1, 2, 3, 4, 6, 8]) {
    for (const width of [260, 300, 340, 380, 420, 460, 500, 620, 800]) {
      const { fileTabs } = await strip(fileCount, width);
      for (const tab of fileTabs) {
        const close = tab.querySelector("button");
        const icon = tab.querySelector("svg");
        if (!close || !icon || getComputedStyle(close).display === "none") {
          continue;
        }
        if (
          close.getBoundingClientRect().left <
          icon.getBoundingClientRect().right
        ) {
          overlaps.push(
            `${fileCount} tabs at ${width}px: ${tab.title} (${tab.offsetWidth}px)`,
          );
        }
      }
    }
  }

  expect(overlaps).toEqual([]);
});

test("keeps whatever the pane is showing on the strip", async () => {
  // A file opened past the end of what fits arrives selected, and the pane
  // draws it. A strip that drew the first tabs and stopped would be showing a
  // file it has no tab for.
  const { fileTabs } = await strip(8, NARROW, "file:output/and-another.zip");

  expect({
    drawn: fileTabs.map((tab) => tab.title),
    selected: fileTabs
      .filter((tab) => tab.ariaSelected === "true")
      .map((tab) => tab.title),
  }).toMatchInlineSnapshot(`
    {
      "drawn": [
        "notes.md",
        "summary.docx",
        "data.csv",
        "screenshot-of-the-thing.png",
        "one-more.txt",
        "and-another.zip",
      ],
      "selected": [
        "and-another.zip",
      ],
    }
  `);
});

test("rules between the tabs, and not against the selected one", async () => {
  // The rule is what says where one tab ends once they are down to icons. It
  // comes off either side of the selected tab, which draws a background of its
  // own and needs no edge.
  const { fileTabs } = await strip(4, NARROW, "file:output/chart.png");

  expect(
    fileTabs.map(
      (tab) =>
        `${tab.title}: ${getComputedStyle(tab, "::after").content === "none" ? "no rule" : "rule"}`,
    ),
  ).toMatchInlineSnapshot(`
    [
      "quarterly-report-2026.pdf: no rule",
      "chart.png: no rule",
      "notes.md: rule",
      "summary.docx: no rule",
    ]
  `);
});

test("still reorders on a drag, with the animation over it turned off", async () => {
  // The layout projection is what registers each tab's box with the group, so
  // it is also what the drag reorders by. Turning the animation off by turning
  // the projection off takes the drag with it, and nothing else here would say
  // so: the tabs would draw correctly and simply stop being draggable.
  const onReorder = vi.fn();
  await renderInBrowser(
    <div style={{ width: 600 }}>
      <PaneTabs
        fileTabs={FILES.slice(0, 3).map((filePath) => ({
          filePath,
          type: "file" as const,
        }))}
        onClose={vi.fn()}
        onReorder={onReorder}
        onSelect={vi.fn()}
        selectedKey="file:output/quarterly-report-2026.pdf"
        taskId={taskId}
      />
    </div>,
  );
  await new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });

  await userEvent.dragAndDrop(
    page.getByTitle("quarterly-report-2026.pdf"),
    page.getByTitle("notes.md"),
  );

  expect(onReorder.mock.calls.at(-1)).toMatchInlineSnapshot(`
    [
      [
        "file:output/chart.png",
        "file:output/quarterly-report-2026.pdf",
        "file:output/notes.md",
      ],
    ]
  `);
});
