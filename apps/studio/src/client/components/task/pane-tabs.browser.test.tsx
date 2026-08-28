import { renderInBrowser } from "@/tests/render-browser";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

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

/**
 * Resolve once the row has stopped moving.
 *
 * The strip lays out for a width of zero first -- every tab, full density --
 * and corrects in a layout effect off a `ResizeObserver`. Both land before the
 * frame is painted, so the app never shows the first one. A test does not get
 * that guarantee by waiting a frame: the delivery and the commit it schedules
 * are what the frame is racing, and on a loaded machine a fixed number of
 * frames is a guess that comes back as a strip drawing the wrong tabs.
 *
 * Stability rather than a deadline, so this reads the row when it is done
 * rather than when a stopwatch says it ought to be.
 */
async function settled(list: HTMLElement) {
  const read = () =>
    [
      list.dataset.density,
      ...[...list.querySelectorAll<HTMLElement>('[role="tab"]')].map(
        (tab) => `${tab.title}:${tab.offsetWidth}`,
      ),
    ].join("|");

  let previous = read();
  for (let frame = 0; frame < 120; frame++) {
    await new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });
    const current = read();
    if (current === previous) {
      return;
    }
    previous = current;
  }
  throw new Error("the tab strip never settled");
}

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

  const list = container.querySelector<HTMLElement>('[role="tablist"]');
  if (list) {
    await settled(list);
  }

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

/**
 * A strip that closes a tab, so the row is laid out for what is left of it.
 *
 * The component takes the tabs it draws from its props, and the collapse is a
 * share of the row being given back, so nothing about it shows against a list
 * that never shrinks.
 */
function ClosingStrip({
  fileCount,
  width,
}: {
  fileCount: number;
  width: number;
}) {
  const [files, setFiles] = useState(FILES.slice(0, fileCount));

  return (
    <div style={{ width }}>
      <PaneTabs
        fileTabs={files.map((filePath) => ({
          filePath,
          type: "file" as const,
        }))}
        onClose={(key) => {
          // A render later, which is what the app does. The tabs come from a
          // query, and the write that drops one notifies its subscribers on
          // its own schedule -- so the close lands in one commit and the
          // shorter list in the next, and for that render the strip is holding
          // a tab it has been told to close and still has.
          queueMicrotask(() => {
            setFiles((current) =>
              current.filter((filePath) => `file:${filePath}` !== key),
            );
          });
        }}
        onReorder={vi.fn()}
        onSelect={vi.fn()}
        // Held on a tab that is not the one being closed, so the widths read
        // afterwards are the collapse rather than a selection moving.
        selectedKey={`file:${FILES[2] ?? ""}`}
        taskId={taskId}
      />
    </div>
  );
}

async function closingStrip(fileCount: number, width: number) {
  const { container } = await renderInBrowser(
    <ClosingStrip fileCount={fileCount} width={width} />,
  );
  const list = container.querySelector<HTMLElement>('[role="tablist"]');
  if (!list) {
    throw new Error("the strip drew no tab list");
  }
  await settled(list);
  return list;
}

/** Close a tab the way the middle button does, at any width. */
function middleClick(list: HTMLElement, filename: string) {
  const tab = list.querySelector(`[role="tab"][title="${filename}"]`);
  if (!tab) {
    throw new Error(`the strip drew no tab for ${filename}`);
  }
  tab.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, button: 1 }),
  );
}

/** What each tab the strip drew came out at, frame by frame. */
async function sample(list: HTMLElement, frames: number) {
  const taken: Record<string, number>[] = [];
  for (let frame = 0; frame < frames; frame++) {
    await new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });
    taken.push(
      Object.fromEntries(
        [...list.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) => [
          tab.title,
          tab.offsetWidth,
        ]),
      ),
    );
  }
  return taken;
}

test("holds a closing tab in the row, collapsed, and then drops it", async () => {
  // The collapse itself is a CSS transition, which this project cuts to zero
  // (see `setup-browser.ts`), so what is read here is the mechanism under it
  // rather than the frames over it: the tab is still in the row and still in
  // its place, it is carrying the widths that hand its share back, it answers
  // to nothing while it does, and it goes when the collapse is over.
  const list = await closingStrip(3, WIDE);
  const closed = "quarterly-report-2026.pdf";

  middleClick(list, closed);
  await new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });

  const collapsing = list.querySelector<HTMLElement>(
    `[role="tab"][title="${closed}"]`,
  );
  if (!collapsing) {
    throw new Error("the strip dropped the tab instead of collapsing it");
  }
  const collapsed = getComputedStyle(collapsing);

  expect({
    // Nobody's tab any more: not read, not reachable, not a stop.
    detached: {
      ariaHidden: collapsing.getAttribute("aria-hidden"),
      pointerEvents: collapsed.pointerEvents,
      tabIndex: collapsing.tabIndex,
    },
    // Off the share it was taking, off the floor under it, and off the gap it
    // would otherwise still be holding open.
    giving: {
      flexGrow: collapsed.flexGrow,
      marginRight: collapsed.marginRight,
      minWidth: collapsed.minWidth,
      opacity: collapsed.opacity,
    },
    // Which the row has taken: three even tabs are two.
    widths: [...list.querySelectorAll<HTMLElement>('[role="tab"]')].map(
      (tab) => `${tab.title}:${tab.offsetWidth}`,
    ),
  }).toMatchInlineSnapshot(`
    {
      "detached": {
        "ariaHidden": "true",
        "pointerEvents": "none",
        "tabIndex": -1,
      },
      "giving": {
        "flexGrow": "0",
        "marginRight": "-4px",
        "minWidth": "0px",
        "opacity": "0",
      },
      "widths": [
        "Browser:86",
        "quarterly-report-2026.pdf:0",
        "chart.png:171",
        "notes.md:171",
      ],
    }
  `);

  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
  expect(list.querySelector(`[role="tab"][title="${closed}"]`)).toBeNull();
});

test("keeps a closing tab where it was rather than at the end of the row", async () => {
  // It is gone from the task's list, so the strip is drawing it from its own
  // copy -- and a copy appended to what is left is a tab that jumps to the end
  // of the row on its way out.
  const list = await closingStrip(3, WIDE);

  middleClick(list, "chart.png");
  const [frame] = await sample(list, 1);

  expect(Object.keys(frame ?? {})).toMatchInlineSnapshot(`
    [
      "Browser",
      "quarterly-report-2026.pdf",
      "chart.png",
      "notes.md",
    ]
  `);
});

test("does not draw a hidden tab into a row a closing tab is still in", async () => {
  // Closing a tab off a full strip makes room for the tab behind the end of it.
  // The room is not there yet: the tab being closed is still collapsing through
  // it. Drawn now, the strip is briefly fuller than it was laid out for and
  // clips the difference, so the run stays where it is until the collapse ends.
  const list = await closingStrip(8, NARROW);
  const before = list.querySelectorAll('[role="tab"]').length;

  middleClick(list, "quarterly-report-2026.pdf");
  const frames = await sample(list, 30);

  expect({
    // Never more tabs than the strip was laid out for.
    overFull: frames
      .map((frame) => Object.keys(frame).length)
      .filter((drawn) => drawn > before),
    // And the one that was behind the end is drawn once the room is real.
    settled: Object.keys(frames.at(-1) ?? {}),
  }).toMatchInlineSnapshot(`
    {
      "overFull": [],
      "settled": [
        "Browser",
        "chart.png",
        "notes.md",
        "summary.docx",
        "data.csv",
        "screenshot-of-the-thing.png",
        "one-more.txt",
      ],
    }
  `);
});

/**
 * Drag the first file tab across the third, recording what the tab being
 * carried was standing on while it moved. Read as it happens, since the drag is
 * over by the time `dragAndDrop` returns.
 *
 * In the dark theme, which is the only one where this can be got wrong: the
 * tints a tab can carry are opaque tokens in the light theme and white at 5-8%
 * in the dark one, so a reading taken in the default theme would agree with
 * anything.
 */
async function carriedSurface(selectedKey: string) {
  document.documentElement.classList.add("dark");
  const { container } = await renderInBrowser(
    <div style={{ width: WIDE }}>
      <PaneTabs
        fileTabs={FILES.slice(0, 3).map((filePath) => ({
          filePath,
          type: "file" as const,
        }))}
        onClose={vi.fn()}
        onReorder={vi.fn()}
        onSelect={vi.fn()}
        selectedKey={selectedKey}
        taskId={taskId}
      />
    </div>,
  );
  const list = container.querySelector<HTMLElement>('[role="tablist"]');
  if (!list) {
    throw new Error("the strip drew no tab list");
  }
  await settled(list);

  const seen = new Set<string>();
  const observer = new MutationObserver(() => {
    for (const tab of list.querySelectorAll<HTMLElement>('[role="tab"]')) {
      if (!tab.className.includes("shadow-xs-soft")) {
        continue;
      }
      const style = getComputedStyle(tab);
      seen.add(
        [
          style.backgroundColor,
          // The alpha is the whole of what was wrong.
          /rgba|\/\s*0?\./.test(style.backgroundColor) ? "SEE-THROUGH" : "opaque",
          // And the selected tint has to survive being stood on the card.
          style.backgroundImage === "none" ? "no tint" : "tinted",
        ].join(", "),
      );
    }
  });
  observer.observe(list, { attributes: true, subtree: true });

  await userEvent.dragAndDrop(
    page.getByTitle("quarterly-report-2026.pdf"),
    page.getByTitle("notes.md"),
  );
  observer.disconnect();
  document.documentElement.classList.remove("dark");
  return [...seen];
}

test("carries a background tab on a surface of its own", async () => {
  // A tab draws nothing of its own until it is hovered, and the hover is a
  // translucent overlay that reads as a tab only because of the row behind it.
  // Lifted out of the row and carried across its neighbors, what is behind it
  // is their names.
  expect(await carriedSurface("browser")).toMatchInlineSnapshot(`
    [
      "rgb(41, 37, 36), opaque, no tint",
    ]
  `);
});

test("carries the tab being read without giving up that it is", async () => {
  // The selected background is the same kind of overlay, so the tab being read
  // has the same hole in it -- and covering that hole must not cost the tint
  // that says which tab the pane is showing.
  expect(await carriedSurface(`file:${FILES[0] ?? ""}`)).toMatchInlineSnapshot(`
    [
      "rgb(41, 37, 36), opaque, tinted",
    ]
  `);
});

/** Which tabs the strip is pointing at, if any. */
function arriving(list: HTMLElement) {
  return [...list.querySelectorAll<HTMLElement>('[role="tab"]')]
    .filter((tab) => tab.className.includes("pane-tab-arriving"))
    .map((tab) => tab.title);
}

/** A strip whose tabs can be added to and whose task can be swapped. */
function ArrivingStrip({
  fileCount,
  width,
}: {
  fileCount: number;
  width: number;
}) {
  const [files, setFiles] = useState(FILES.slice(0, fileCount));
  const [id, setId] = useState(taskId);

  return (
    <div style={{ width }}>
      <button
        onClick={() => {
          setFiles((current) => [...current, FILES[current.length] ?? ""]);
        }}
        type="button"
      >
        open one
      </button>
      <button
        onClick={() => {
          setFiles(FILES.slice(0, fileCount).toReversed());
          setId(TaskIdSchema.parse("pane-tabs-other"));
        }}
        type="button"
      >
        another task
      </button>
      <PaneTabs
        fileTabs={files.map((filePath) => ({
          filePath,
          type: "file" as const,
        }))}
        onClose={vi.fn()}
        onReorder={vi.fn()}
        onSelect={vi.fn()}
        selectedKey={`file:${FILES[0] ?? ""}`}
        taskId={id}
      />
    </div>
  );
}

test("points at a tab that was just opened, and at nothing else", async () => {
  // A tab the strip has started drawing is not necessarily one that arrived:
  // the run it has room for slides along, a collapsing tab hands its place to
  // whatever was behind the end of it, and another task's row is new in its
  // entirety. Pointing at any of those points at nothing.
  const { container } = await renderInBrowser(
    <ArrivingStrip fileCount={3} width={WIDE} />,
  );
  const list = container.querySelector<HTMLElement>('[role="tablist"]');
  if (!list) {
    throw new Error("the strip drew no tab list");
  }
  await settled(list);

  const onFirstPaint = arriving(list);

  await page.getByRole("button", { name: "open one" }).click();
  const onOpen = arriving(list);

  // Long enough for the growth to be over, so the class does not outlive it.
  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
  const afterwards = arriving(list);

  await page.getByRole("button", { name: "another task" }).click();
  const onTaskSwitch = arriving(list);

  expect({
    afterwards,
    onFirstPaint,
    onOpen,
    onTaskSwitch,
  }).toMatchInlineSnapshot(`
    {
      "afterwards": [],
      "onFirstPaint": [],
      "onOpen": [
        "summary.docx",
      ],
      "onTaskSwitch": [],
    }
  `);
});
