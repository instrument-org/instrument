import { ariaSnapshot } from "@/tests/aria-snapshot";
import { renderInBrowser } from "@/tests/render-browser";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { expect, test } from "vitest";

import { AgentFilesBlock } from "./agent-files-block";
import { MarkdownTaskContext } from "./markdown-task-context";

/**
 * What a ```files fence lays out, which jsdom cannot answer: with no layout
 * engine every tile is zero by zero and the numbers below are all the same
 * number.
 *
 * Two things are measured. The grid's height as the fence arrives, because the
 * last line is held back until the message stops streaming -- the same frame
 * the session goes idle in -- so any height that lands there is height the
 * reader has to go and find. And the tiles' widths at three column widths,
 * because both of the rules that set them are container queries and the same
 * grid is drawn in a message column, a pane, and a card.
 *
 * The third thing is not a measurement at all: what the grid *is*, to anything
 * that reads structure rather than pixels -- a screen reader, or a script
 * driving the app.
 */

// Either side of the breakpoint the media rule turns on, @xl at 36rem. The
// message column sits at the widest of the three.
const NARROW = 380;
const MEDIUM = 500;
const WIDE = 640;

function drawFence(
  content: string,
  { isStreaming = false, width = WIDE } = {},
) {
  return renderInBrowser(
    <div style={{ width }}>
      <MarkdownTaskContext
        value={{
          assetBaseUrl: "http://assets.example.test",
          isStreaming,
          taskId: TaskIdSchema.parse("quarterly-numbers"),
        }}
      >
        <AgentFilesBlock content={content} />
      </MarkdownTaskContext>
    </div>,
  );
}

async function fenceHeight(content: string, isStreaming: boolean) {
  const { container } = await drawFence(content, { isStreaming });

  return Math.round(container.getBoundingClientRect().height);
}

// Every media tile in the grid, drawn or reserved, by the box the width rule
// is written on -- not by the card inside it, whose own shape is one of the
// things that rule decides.
async function tileWidths(content: string, width: number) {
  const { container } = await drawFence(content, { width });

  return [
    ...container.querySelectorAll<HTMLElement>(
      "[data-slot='files-grid-media']",
    ),
  ].map((tile) => Math.round(tile.getBoundingClientRect().width));
}

test("names every file it draws, in the tree and not just on screen", async () => {
  // Not a measurement: the roles and accessible names a screen reader is handed,
  // and the same tree a script driving the app has to find its way around by.
  // A card whose name goes missing lays out exactly as it did before, so it is
  // a failure neither the heights above nor the widths below can see.
  //
  // One line per file and nothing else: every file a fence names is drawn, and
  // the grid offers no control of its own. The icons are decorative and hidden
  // as such, so what is left is exactly the set of things that can be
  // addressed.
  const { locator } = await drawFence(
    "output/revenue.png\noutput/notes.md\noutput/clip.mp4",
  );

  await expect(ariaSnapshot(locator)).resolves.toMatchInlineSnapshot(`
    "- button "Open revenue.png"
    - button "Open clip.mp4"
    - button "Open notes.md"
    - text: notes.md Markdown
    - button "Actions for notes.md""
  `);
});

test("lands a lone tile's edge on the column its file cards are laid out on", async () => {
  // The point of giving one tile all but the last column rather than a width of
  // its own: the picture ends where a card below it ends, instead of at a
  // measurement nothing else in the grid shares.
  const { container } = await drawFence(
    "output/chart.png\noutput/report.md\noutput/data.csv\noutput/notes.txt",
    { width: WIDE },
  );

  const tile = container.querySelector("[data-slot='files-grid-media']");
  const cards = container.querySelectorAll("[data-slot='files-grid-card']");

  expect(cards).toHaveLength(3);
  expect(Math.round(tile?.getBoundingClientRect().right ?? 0)).toBe(
    Math.round(cards[1]?.getBoundingClientRect().right ?? 0),
  );
});

test("keeps a row of media the same height as its last card lands", async () => {
  // A video and an image, which is where the heights used to diverge: the
  // video card was 16:9 and the image square, so the square arriving last grew
  // the row by the difference. The line being typed reserves the tile that
  // holds the count -- and so the widths -- steady across the settle.
  const fence = "output/clip.mp4\noutput/chart.png";

  const streaming = await fenceHeight(fence, true);
  const settled = await fenceHeight(fence, false);

  expect(streaming).toBe(settled);
});

test("keeps a lone file the same size as its card lands", async () => {
  const fence = "output/chart.png";

  const streaming = await fenceHeight(fence, true);
  const settled = await fenceHeight(fence, false);

  expect(streaming).toBe(settled);
});

test("gives one file the column and a set of them a grid", async () => {
  const alone = "output/chart.png";
  const several = "output/one.png\noutput/two.png\noutput/three.png";

  expect({
    alone: {
      medium: await tileWidths(alone, MEDIUM),
      narrow: await tileWidths(alone, NARROW),
      wide: await tileWidths(alone, WIDE),
    },
    several: {
      medium: await tileWidths(several, MEDIUM),
      narrow: await tileWidths(several, NARROW),
      wide: await tileWidths(several, WIDE),
    },
  }).toMatchInlineSnapshot(`
    {
      "alone": {
        "medium": [
          500,
        ],
        "narrow": [
          380,
        ],
        "wide": [
          424,
        ],
      },
      "several": {
        "medium": [
          246,
          246,
          246,
        ],
        "narrow": [
          186,
          186,
          186,
        ],
        "wide": [
          208,
          208,
          208,
        ],
      },
    }
  `);
});
