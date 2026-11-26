import { describe, expect, it } from "vitest";

import { loadDiagram, toDiagramImageUrl } from "./mermaid";

// The full-window preview shows a diagram in an `img`, which reads it as a file
// of its own: it has to be well-formed XML, links included, and it has none of
// the page's CSS, which is where pele's colors come from. A `click` directive
// is the way to get pele to emit a link.
const LINKED = `flowchart LR
  F[[Worker service]] --> G[Generate result]
  click F "https://pele.run/" "Open the pele documentation"
`;

const PLAIN = "graph TD\n  A[Start] --> B[End]";

async function draw(code: string) {
  const host = document.createElement("div");
  // A color no fallback of pele's could produce, standing in for a theme's.
  host.style.setProperty("--pele-bg", "rgb(1, 2, 3)");
  document.body.append(host);
  const drawDiagram = await loadDiagram(code);
  drawDiagram?.(host, {});
  const svg = host.querySelector("svg");
  if (!svg) {
    throw new Error("diagram did not render");
  }
  return svg;
}

describe("toDiagramImageUrl", () => {
  it.each([
    ["a diagram that declares a link", LINKED],
    ["an ordinary diagram", PLAIN],
  ])("opens %s", async (_case, code) => {
    const url = toDiagramImageUrl(await draw(code));

    expect(url?.startsWith("data:image/svg+xml")).toBe(true);
    const xml = decodeURIComponent(url?.split(",")[1] ?? "");
    const image = new DOMParser().parseFromString(xml, "image/svg+xml");
    expect(image.querySelector("parsererror")).toBeNull();
    expect(image.documentElement.namespaceURI).toBe(
      "http://www.w3.org/2000/svg",
    );
  });

  it("carries the colors the diagram was drawn in", async () => {
    const url = toDiagramImageUrl(await draw(PLAIN));
    const xml = decodeURIComponent(url?.split(",")[1] ?? "");
    const style = new DOMParser()
      .parseFromString(xml, "image/svg+xml")
      .documentElement.getAttribute("style");

    expect(style).toContain("--pele-bg: rgb(1, 2, 3)");
    expect(style).toContain("background-color: var(--pele-bg)");
  });
});
