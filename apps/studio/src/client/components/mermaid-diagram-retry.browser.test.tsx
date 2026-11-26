import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it, vi } from "vitest";

import type * as MermaidLib from "../lib/mermaid";

import { MermaidDiagram } from "./mermaid-diagram";
import { ThemeProvider } from "./theme-provider";

// The loaders drop a rejected import so the chunk can be fetched again, but
// that only helps a caller who calls again. A diagram in a finished message
// never does: its source and visibility have both settled, so nothing re-runs
// its effect. This covers the diagram that actually failed.
//
// The module is mocked rather than driven for real because a dropped chunk
// fetch is not something a passing network can be asked to produce, and the
// subject here is the component's own recovery, not pele's output. It lives in
// its own file so the module-level mock stays clear of the tests next door
// that draw real diagrams.

const { loadDiagram } = vi.hoisted(() => ({ loadDiagram: vi.fn() }));

vi.mock("../lib/mermaid", async (importOriginal) => {
  const actual = await importOriginal<typeof MermaidLib>();
  loadDiagram.mockImplementation(actual.loadDiagram);
  return { ...actual, loadDiagram };
});

describe("MermaidDiagram chunk-load failure", () => {
  it("retries the diagram whose own load threw", async () => {
    loadDiagram.mockRejectedValueOnce(
      new Error("Failed to fetch dynamically imported module"),
    );

    const { container } = await renderInBrowser(
      <ThemeProvider>
        <MermaidDiagram
          code={"graph TD\n  A[Start] --> B[End]"}
          language="mermaid"
        />
      </ThemeProvider>,
    );

    // Nothing about this diagram changes after the first render: no new
    // tokens, no scrolling. Recovery has to come from the component.
    await expect
      .poll(() => container.querySelector("svg.pele"), { timeout: 5000 })
      .toBeTruthy();
    expect(loadDiagram).toHaveBeenCalledTimes(2);
  });
});
