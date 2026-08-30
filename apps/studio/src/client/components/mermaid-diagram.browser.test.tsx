import { filePreviewAtom } from "@/client/atoms/file-preview";
import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it, vi } from "vitest";

import { MermaidDiagram } from "./mermaid-diagram";
import { ThemeProvider } from "./theme-provider";
import { TranscriptScrollContext } from "./transcript-scroll-context";

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
  const screen = await renderInBrowser(
    <ThemeProvider>
      <div style={{ width: 600 }}>
        <MermaidDiagram code={code} language="mermaid" />
      </div>
    </ThemeProvider>,
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
      <ThemeProvider>
        <div style={{ width: 600 }}>
          <MermaidDiagram code={GRAPH} language="mermaid" />
        </div>
      </ThemeProvider>,
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

    // A re-render whose source has regressed to something unparsable must not
    // blank the diagram out; nothing on screen should ever go backwards.
    await rerender(
      <ThemeProvider>
        <div style={{ width: 600 }}>
          <MermaidDiagram code={BROKEN_GRAPH} language="mermaid" />
        </div>
      </ThemeProvider>,
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

  it("waits for the viewport before rendering a diagram below the fold", async () => {
    // Pushed far past the bottom of the window. A message can carry many
    // diagrams, and laying each one out is main-thread work, so the ones the
    // reader has not reached must not be paid for on mount.
    const { container } = await renderInBrowser(
      <ThemeProvider>
        <div style={{ height: "400vh" }} />
        <div style={{ width: 600 }}>
          <MermaidDiagram code={GRAPH} language="mermaid" />
        </div>
      </ThemeProvider>,
    );

    // The source is what stands in for it, exactly as it does mid-stream.
    await expect.poll(() => container.textContent).toContain("A[Start]");
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
    expect(diagramSvg(container)).toBeNull();

    container.querySelector("[style*='width: 600px']")?.scrollIntoView();

    await expect.poll(() => diagramSvg(container)).toBeTruthy();
  });

  it("gets its head start inside a scrolling ancestor", async () => {
    // The transcript is a scroll container, not the window. `rootMargin`
    // expands only the observer's root, and a scrolling ancestor clips the
    // target before that rect is consulted — so a diagram watched against the
    // window is reported near only once it is already on screen, and the
    // reader sees the source block flash before it. It has to start rendering
    // while it is still below the fold.
    const { container } = await renderInBrowser(
      <ThemeProvider>
        <div style={{ height: 300, overflowY: "auto" }}>
          <div style={{ height: 2000 }} />
          <div style={{ width: 600 }}>
            <MermaidDiagram code={GRAPH} language="mermaid" />
          </div>
        </div>
      </ThemeProvider>,
    );

    const scroller = container.querySelector<HTMLElement>(
      "[style*='overflow-y: auto']",
    );
    const diagram = container.querySelector("[style*='width: 600px']");
    if (!scroller || !diagram) {
      throw new Error("scroller did not render");
    }

    // 2000px down is far past any head start: still just source.
    await expect.poll(() => container.textContent).toContain("A[Start]");
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
    expect(diagramSvg(container)).toBeNull();

    // Now 200px below the scroller's bottom edge — inside the head start,
    // still out of sight.
    scroller.scrollTop = 1500;

    await expect.poll(() => diagramSvg(container)).toBeTruthy();
    // The point of the head start: it rendered while still out of sight.
    expect(diagram.getBoundingClientRect().top).toBeGreaterThan(
      scroller.getBoundingClientRect().bottom,
    );
  });

  it("draws nodes the reader can tell apart from the surface in dark mode", async () => {
    // Mermaid's own dark theme fills a node with a near-black a shade off our
    // background, which reads as an outline drawn on nothing. The palette we
    // hand it makes a node a card on a surface, the same as the rest of the
    // app, and this is the property that has to hold for it to be legible at
    // all — asserting the exact color would only restate the token.
    const { container } = await renderInBrowser(
      <ThemeProvider defaultTheme="dark">
        <div className="bg-background">
          <MermaidDiagram code={GRAPH} language="mermaid" />
        </div>
      </ThemeProvider>,
    );

    await expect.poll(() => diagramSvg(container)).toBeTruthy();
    const node = diagramSvg(container)?.querySelector("rect");
    const surface = container.querySelector(".bg-background");
    if (!node || !surface) {
      throw new Error("diagram did not render");
    }

    expect(globalThis.getComputedStyle(node).fill).not.toBe(
      globalThis.getComputedStyle(surface).backgroundColor,
    );
  });

  // While the transcript's scroller follows the live end, swapping the diagram
  // for its taller or shorter source re-pins it to the bottom and carries the
  // view the reader just asked for off screen. `TranscriptScrollContext` is the
  // contract: every control that reshapes a block hands scrolling back first.
  it("hands scrolling back to the reader before swapping in the source", async () => {
    const releaseAutoScroll = vi.fn();
    const screen = await renderInBrowser(
      <TranscriptScrollContext value={releaseAutoScroll}>
        <ThemeProvider>
          <div style={{ width: 600 }}>
            <MermaidDiagram code={GRAPH} language="mermaid" />
          </div>
        </ThemeProvider>
      </TranscriptScrollContext>,
    );
    await expect.poll(() => diagramSvg(screen.container)).toBeTruthy();

    await screen.getByRole("button", { name: "Show source" }).click();

    expect(releaseAutoScroll).toHaveBeenCalledOnce();
  });

  it("styles the source view as an ordinary code block", async () => {
    const screen = await renderInBrowser(
      <ThemeProvider>
        <div className="prose prose-custom">
          <MermaidDiagram code={GRAPH} language="mermaid" />
        </div>
      </ThemeProvider>,
    );

    await expect.poll(() => diagramSvg(screen.container)).toBeTruthy();
    await screen.getByRole("button", { name: "Show source" }).click();

    const pre = await vi.waitFor(() => {
      const found = screen.container.querySelector("pre");
      if (!found) {
        throw new Error("source view did not render");
      }
      return found;
    });

    // `not-prose` anywhere above the source view strips the typography styles
    // that give every other code block its surface, leaving the source on a
    // transparent background that matches nothing else in the transcript.
    expect(globalThis.getComputedStyle(pre).backgroundColor).not.toBe(
      "rgba(0, 0, 0, 0)",
    );
  });

  it("opens the diagram full-window", async () => {
    // A diagram is fitted to the column, so a large one arrives small and the
    // full-window preview — not anything inline — is where it gets read. The
    // SVG is handed over as a data URL carrying the surface it was drawn
    // against, since an `img` brings none of the page's CSS with it.
    const screen = await renderInBrowser(
      <ThemeProvider>
        <div style={{ width: 600 }}>
          <MermaidDiagram code={GRAPH} language="mermaid" />
        </div>
      </ThemeProvider>,
    );
    await expect.poll(() => diagramSvg(screen.container)).toBeTruthy();

    expect(screen.store.get(filePreviewAtom).isOpen).toBe(false);
    await screen.getByRole("button", { name: "Open diagram" }).click();

    const preview = screen.store.get(filePreviewAtom);
    expect(preview.isOpen).toBe(true);
    expect(preview.file?.url.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("leaves the diagram itself selectable", async () => {
    const { container } = await renderDiagram(GRAPH);
    await expect.poll(() => diagramSvg(container)).toBeTruthy();

    // Wrapping the diagram in a button to catch a click made its labels
    // unselectable and gave the whole surface a single meaning. Expanding is
    // the toolbar's job, and nothing between the frame and the drawing may be
    // a control.
    const svg = diagramSvg(container);
    if (!svg) {
      throw new Error("diagram did not render");
    }
    expect(svg.closest("button")).toBeNull();
    expect(globalThis.getComputedStyle(svg).userSelect).not.toBe("none");
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
