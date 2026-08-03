import "@/client/styles/globals.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type * as MermaidLib from "../lib/mermaid";

import { MermaidDiagram } from "./mermaid-diagram";
import { ThemeProvider } from "./theme-provider";

// `loadMermaid` drops a rejected import so the chunk can be fetched again, but
// that only helps a caller who calls again. A diagram in a finished message
// never does: its source, theme and visibility have all settled, so nothing
// re-runs its render effect. This covers the diagram that actually failed.
//
// The module is mocked rather than driven for real because a dropped chunk
// fetch is not something a passing network can be asked to produce, and the
// subject here is the component's own recovery, not mermaid's output. It lives
// in its own file so the module-level mock stays clear of the tests next door
// that render real diagrams.

const { renderMermaid } = vi.hoisted(() => ({ renderMermaid: vi.fn() }));

vi.mock("../lib/mermaid", async (importOriginal) => ({
  ...(await importOriginal<typeof MermaidLib>()),
  renderMermaid,
}));

describe("MermaidDiagram chunk-load failure", () => {
  it("retries the diagram whose own render threw", async () => {
    renderMermaid
      .mockRejectedValueOnce(
        new Error("Failed to fetch dynamically imported module"),
      )
      .mockResolvedValue('<svg id="mermaid-diagram-1" />');

    const { container } = await render(
      <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider>
          <MermaidDiagram
            code="graph TD\n  A[Start] --> B[End]"
            language="mermaid"
          />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    // The source block is what a failed diagram falls back to, and with no
    // retry it is where this one would stay.
    await expect.poll(() => container.textContent).toContain("A[Start]");

    // Nothing about this diagram changes in the meantime: no new tokens, no
    // theme flip, no scrolling. Recovery has to come from the component.
    await expect
      .poll(() => container.querySelector("svg[id^='mermaid-diagram-']"), {
        timeout: 5000,
      })
      .toBeTruthy();
    expect(renderMermaid).toHaveBeenCalledTimes(2);
  });
});
