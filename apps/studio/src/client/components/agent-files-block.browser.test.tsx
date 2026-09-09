import { ariaSnapshot } from "@/tests/aria-snapshot";
import { renderInBrowser } from "@/tests/render-browser";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { afterEach, expect, test, vi } from "vitest";

import { AgentFilesBlock } from "./agent-files-block";
import { FilesLayoutContext } from "./files-layout-context";
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
  {
    isStreaming = false,
    layout = "grid",
    width = WIDE,
  }: { isStreaming?: boolean; layout?: "grid" | "list"; width?: number } = {},
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
        <FilesLayoutContext.Provider value={layout}>
          <AgentFilesBlock content={content} />
        </FilesLayoutContext.Provider>
      </MarkdownTaskContext>
    </div>,
  );
}

/**
 * An asset origin that answers every probe the same way. The origin the tests
 * name does not exist, so left alone a probe fails as a network error, which
 * a card reads as "nothing known"; this is how a test says the file is gone.
 */
function originAnswering(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(null, { status }))),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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

test("says a file is missing, keeps its line where the reply put it, and offers nothing to press", async () => {
  // A transcript is a record of what a reply handed over; a file gone since
  // is drawn as gone rather than dropped. Asked of the origin once the card is
  // near the viewport, which every card in a test's viewport is. A press could
  // only end in an error, so the line stops being a control.
  originAnswering(404);
  const { getByRole, getByText } = await drawFence(
    "output/notes.md\noutput/here.txt",
    { layout: "list" },
  );

  await expect.element(getByText("here.txt")).toBeInTheDocument();
  await expect.element(getByText("Missing").first()).toBeInTheDocument();
  expect(getByText("Missing").all()).toHaveLength(2);
  await expect
    .element(getByRole("button", { name: /here\.txt/ }))
    .toBeDisabled();
});

test("draws a folder as a folder, in the place the fence gave it", async () => {
  // The origin serves files, so it has no answer for a folder but a 404 -- the
  // answer a file gives when it is gone. A folder drawn as a file is therefore
  // a line reading "Missing", with nothing where the name should be, since the
  // slash it ends in leaves the last segment empty.
  originAnswering(404);
  const { getByRole, getByText } = await drawFence(
    "/mnt/Instrument/notes.md\n/mnt/Instrument/backups/",
    { layout: "list" },
  );

  await expect.element(getByText("backups")).toBeInTheDocument();
  await expect.element(getByText("Folder")).toBeInTheDocument();
  await expect.element(getByRole("button", { name: /backups/ })).toBeEnabled();
});

test("names a file's kind beside it the way the row cards do", async () => {
  // The line's right-hand text used to be the extension upper-cased, which is
  // the filename said twice; it is the kind the row cards say.
  originAnswering(206);
  const { getByText } = await drawFence("output/notes.md\noutput/here.txt", {
    layout: "list",
  });

  await expect.element(getByText("Markdown")).toBeInTheDocument();
  await expect.element(getByText("Text file")).toBeInTheDocument();
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
