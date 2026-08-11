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
 */

// Either side of the grid's two container breakpoints: @md at 28rem and @xl at
// 36rem. The message column sits at the widest of the three.
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

// Every media tile in the grid, drawn or reserved, by the shape they share.
async function tileWidths(content: string, width: number) {
  const { container } = await drawFence(content, { width });

  return [...container.querySelectorAll<HTMLElement>(".aspect-square")].map(
    (tile) => Math.round(tile.getBoundingClientRect().width),
  );
}

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
          331,
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
