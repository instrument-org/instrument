import "@/client/styles/globals.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { MermaidDiagram } from "./mermaid-diagram";
import { ThemeProvider } from "./theme-provider";

// Mermaid lays a diagram out by measuring the text it is about to draw, so it
// needs `getBBox` and a font — neither of which jsdom has. A test there sees no
// SVG whether the component works or not, which is exactly the shape of test
// that passes forever while the feature is broken. So every assertion about a
// diagram actually appearing lives here, in a real browser.

const GRAPH = "graph TD\n  A[Start] --> B[End]";
// Half of the graph above, the way it looks a few tokens into a stream.
const PARTIAL_GRAPH = "graph TD\n  A[Star";
// Parses as no diagram type at all, which is where source that never becomes
// valid ends up.
const BROKEN_GRAPH = "graph TD\n  A --> ((((";

async function renderDiagram(code: string) {
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      {/* The component reads the resolved theme to pick mermaid's palette;
          without a provider `useTheme` throws. */}
      <ThemeProvider>
        <div style={{ width: 600 }}>
          <MermaidDiagram code={code} language="mermaid" />
        </div>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return screen;
}

// Mermaid stamps the id it was rendered under onto the SVG root, which makes it
// distinguishable from the icon SVGs the toolbar buttons are built from.
const diagramSvg = (container: HTMLElement) =>
  container.querySelector("svg[id^='mermaid-diagram-']");

describe("MermaidDiagram", () => {
  it("renders a diagram once the source parses", async () => {
    const { container } = await renderDiagram(GRAPH);

    await expect.poll(() => diagramSvg(container)).toBeTruthy();
    // The labels are the proof mermaid got far enough to lay the graph out,
    // rather than having emitted an empty root element.
    expect(diagramSvg(container)?.textContent).toContain("Start");
    expect(diagramSvg(container)?.textContent).toContain("End");
  });

  it("shows the source, and no error graphic, when it never parses", async () => {
    const { container } = await renderDiagram(BROKEN_GRAPH);

    // Give the render a chance to happen before concluding it did not.
    await expect.poll(() => container.textContent).toContain("A --> ((((");
    expect(diagramSvg(container)).toBeNull();
    // `suppressErrorRendering` is the setting that keeps mermaid from putting
    // its own "Syntax error in text" graphic on the page. It renders into the
    // document body rather than into our subtree, so check the whole page.
    expect(document.body.textContent).not.toContain("Syntax error");
  });

  it("holds the source while a graph is still streaming in", async () => {
    const { container, rerender } = await renderDiagram(PARTIAL_GRAPH);

    await expect.poll(() => container.textContent).toContain("A[Star");
    expect(diagramSvg(container)).toBeNull();

    await rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider>
          <div style={{ width: 600 }}>
            <MermaidDiagram code={GRAPH} language="mermaid" />
          </div>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    await expect.poll(() => diagramSvg(container)).toBeTruthy();
  });

  it("keeps the last good diagram when the source stops parsing", async () => {
    const { container, rerender } = await renderDiagram(GRAPH);
    await expect.poll(() => diagramSvg(container)).toBeTruthy();

    // Polling for the diagram after the fact would pass on timing alone: the
    // old SVG is still mounted for the moment it takes the new source to fail,
    // so a component that does blank out looks fine to an assertion that
    // happens to run first. Watching for the removal instead catches it
    // whenever it lands.
    let wentBlank = false;
    const observer = new MutationObserver(() => {
      if (!diagramSvg(container)) {
        wentBlank = true;
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    // A re-render whose source has regressed to something unparseable must not
    // blank the diagram out; nothing on screen should ever go backwards.
    await rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider>
          <div style={{ width: 600 }}>
            <MermaidDiagram code={BROKEN_GRAPH} language="mermaid" />
          </div>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    // A failed parse resolves in microseconds; this is room for the commit, the
    // deferred pass, the effect, and the state update that would follow.
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
    observer.disconnect();

    expect(wentBlank).toBe(false);
    expect(diagramSvg(container)?.textContent).toContain("Start");
  });

  it("keeps a wide diagram inside its column", async () => {
    const wide = [
      "graph LR",
      ...Array.from(
        { length: 14 },
        (_, index) =>
          `  N${index}[Node with a fairly long label ${index}] --> N${index + 1}[Node with a fairly long label ${index + 1}]`,
      ),
    ].join("\n");

    const { container } = await renderDiagram(wide);
    await expect.poll(() => diagramSvg(container)).toBeTruthy();

    const column = container.firstElementChild;
    const svg = diagramSvg(container);
    if (!column || !svg) {
      throw new Error("diagram did not render");
    }

    // The chat column is the thing being protected: a diagram far wider than it
    // must be scaled or scrolled, never allowed to push the column open.
    expect(svg.getBoundingClientRect().width).toBeLessThanOrEqual(
      column.getBoundingClientRect().width + 1,
    );
  });
});
