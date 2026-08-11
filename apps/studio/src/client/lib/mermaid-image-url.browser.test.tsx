import { describe, expect, it } from "vitest";

import { renderMermaid, toDiagramImageUrl } from "./mermaid";

// Mermaid writes `xlink:href` without ever declaring that namespace, so its own
// output is not well-formed XML. Reading it back with a strict parse gives a
// parser-error document rather than a diagram, and since the full-window
// preview is reached by re-reading the rendered SVG, every diagram carrying a
// link quietly stopped being openable at all. A `click` directive is the way to
// get mermaid to emit one.
const LINKED = `flowchart LR
  F[[Worker service]] --> G[Generate result]
  click F "https://mermaid.js.org/" "Open Mermaid documentation"
`;

const PLAIN = "graph TD\n  A[Start] --> B[End]";

describe("toDiagramImageUrl", () => {
  it.each([
    ["a diagram that declares a link", LINKED],
    ["an ordinary diagram", PLAIN],
  ])("opens %s", async (_case, code) => {
    const svg = await renderMermaid({ code, theme: "light" });
    if (!svg) {
      throw new Error("diagram did not render");
    }

    const url = toDiagramImageUrl({ background: "rgb(255, 255, 255)", svg });

    expect(url?.startsWith("data:image/svg+xml")).toBe(true);
    // The namespace has to survive the round trip, or the `img` the preview
    // puts this in renders nothing at all.
    expect(decodeURIComponent(url ?? "")).toContain(
      'xmlns="http://www.w3.org/2000/svg"',
    );
  });
});
