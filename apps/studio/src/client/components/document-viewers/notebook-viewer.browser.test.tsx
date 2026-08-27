// cspell:ignore dataframe ipython
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import "../../styles/globals.css";
import { ThemeProvider } from "../theme-provider";
import { TooltipProvider } from "../ui/tooltip";
import { NotebookViewer } from "./notebook-viewer";

/**
 * The viewer over a notebook carrying one of everything.
 *
 * `notebook-format.test.ts` covers the parsing and `notebook-html.test.tsx` the
 * sanitizer; what is left is whether the two meet the renderers correctly, and
 * most of that is only observable in a real browser: the cell gutter is shown
 * by a container query, an attachment reaches the page as a `data:` URI the
 * markdown renderer has to be persuaded to keep, and an SVG bundle is served to
 * an `<img>`.
 *
 * Syntax highlighting is absent here, since it is an RPC to the main process.
 * Code renders as the plain text it falls back to, which is what the viewer
 * shows before the highlighting lands anyway.
 */
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const SVG_CHART =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120">' +
  '<rect x="20" y="60" width="40" height="50" fill="#36c"/></svg>';

const NOTEBOOK = {
  cells: [
    {
      attachments: { "shot.png": { "image/png": PNG_1X1 } },
      cell_type: "markdown",
      source: ["# Sales analysis\n", "\n", "![shot](attachment:shot.png)\n"],
    },
    {
      cell_type: "code",
      execution_count: 1,
      outputs: [
        {
          data: {
            // A pandas repr, formatted the way one actually arrives.
            "text/html": [
              '<table border="1" class="dataframe">\n',
              "  <thead>\n",
              "    <tr>\n      <th>region</th>\n      <th>total</th>\n    </tr>\n",
              "  </thead>\n",
              "  <tbody>\n",
              "    <tr>\n      <td>North</td>\n      <td>1200</td>\n    </tr>\n",
              "  </tbody>\n",
              "</table>",
            ],
            "text/plain": ["  region  total\n", "0  North   1200\n"],
          },
          execution_count: 1,
          output_type: "execute_result",
        },
      ],
      source: "df.groupby('region').sum()",
    },
    {
      cell_type: "code",
      execution_count: 2,
      outputs: [
        {
          data: { "image/svg+xml": SVG_CHART, "text/plain": "<Figure>" },
          output_type: "display_data",
        },
      ],
      source: "df.plot.bar()",
    },
    {
      cell_type: "code",
      execution_count: 3,
      outputs: [
        { name: "stdout", output_type: "stream", text: ["step 1\n"] },
        { name: "stdout", output_type: "stream", text: ["step 2\n"] },
        {
          name: "stderr",
          output_type: "stream",
          text: ["  0%|  | 0/3\r 66%|██  | 2/3\r100%|████| 3/3\n"],
        },
      ],
      source: "for i in range(3):\n    print(f'step {i}')",
    },
    {
      cell_type: "code",
      execution_count: 4,
      outputs: [
        {
          ename: "ZeroDivisionError",
          evalue: "division by zero",
          output_type: "error",
          traceback: [
            "[0;31mZeroDivisionError[0m   Traceback (most recent call last)",
            "[0;32m<ipython-input-4>[0m in [0;36m<module>[0m",
          ],
        },
      ],
      source: "1 / 0",
    },
  ],
  metadata: { language_info: { name: "python" } },
  nbformat: 4,
  nbformat_minor: 5,
};

async function renderNotebook(width: number) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(NOTEBOOK)], { type: "application/json" }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const { container } = await render(
    <QueryClientProvider client={client}>
      {/* Radix throws without one, and a test rendering a single viewer is the
          app root it is asking for. */}
      <TooltipProvider>
        <ThemeProvider defaultTheme="light">
          <div className="flex h-[900px] flex-col" style={{ width }}>
            <NotebookViewer url={url} />
          </div>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );

  // The document arrives over `fetch`, so nothing is on the page synchronously.
  await expect.poll(() => container.querySelectorAll("table").length).toBe(1);
  return container;
}

describe("NotebookViewer", () => {
  it("inlines a cell attachment as an image", async () => {
    // The markdown renderer's own URL filter drops `data:` unless the viewer
    // hands it back, and an attachment has no other way to arrive.
    const container = await renderNotebook(760);

    const sources = [...container.querySelectorAll("img")].map((image) =>
      image.getAttribute("src"),
    );
    expect(sources.some((src) => src?.startsWith("data:image/png;base64,"))).toBe(
      true,
    );
  });

  it("serves an svg bundle to an img rather than inlining it", async () => {
    const container = await renderNotebook(760);

    const sources = [...container.querySelectorAll("img")].map((image) =>
      image.getAttribute("src"),
    );
    expect(sources.some((src) => src?.startsWith("data:image/svg+xml"))).toBe(
      true,
    );
    // Inline `<svg>` carries its own scripts, so none of the notebook's own
    // markup reaches the page as one. Scoped to the cells, since the toolbar
    // draws its icons with `<svg>`.
    expect(cells(container).querySelector("svg")).toBeNull();
  });

  it("renders a DataFrame as a table", async () => {
    const container = await renderNotebook(760);

    const table = container.querySelector("table");
    expect(table?.textContent).toContain("North");
    expect(table?.textContent).toContain("1200");
    // The file's own class names never reach an element the app styles.
    expect(table?.getAttribute("class")).toBeNull();
  });

  it("merges stream chunks and collapses a progress bar to its last frame", async () => {
    const container = await renderNotebook(760);

    const text = container.textContent;
    expect(text).toContain("step 1\nstep 2");
    expect(text).toContain("100%|████| 3/3");
    expect(text).not.toContain("0%|  | 0/3");
  });

  it("keeps the color that makes a traceback readable", async () => {
    const container = await renderNotebook(760);

    const colored = [...container.querySelectorAll("pre span")].filter(
      (element) => element.className.includes("text-red"),
    );
    expect(colored.length).toBeGreaterThan(0);
  });

  it("collapses the execution-count gutter on a narrow panel", async () => {
    const wide = await renderNotebook(760);
    expect(visibleGutters(wide)).toContain("In [1]:");

    const narrow = await renderNotebook(460);
    expect(visibleGutters(narrow)).toEqual([]);
  });
});

/** The cells, without the toolbar above them. */
function cells(container: HTMLElement): HTMLElement {
  const element = container.querySelector("[class*='@container/notebook']");
  if (!(element instanceof HTMLElement)) {
    throw new TypeError("the notebook did not render its cells");
  }
  return element;
}

/** The gutter labels a reader can actually see at the current width. */
function visibleGutters(container: HTMLElement): string[] {
  return [...container.querySelectorAll("div")]
    .filter(
      (element) =>
        /^(?:In \[|Out\[)/.test(element.textContent) &&
        element.childElementCount === 0 &&
        element.checkVisibility(),
    )
    .map((element) => element.textContent);
}
