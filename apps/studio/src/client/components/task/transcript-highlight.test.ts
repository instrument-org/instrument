import { describe, expect, it } from "vitest";

import { highlightedLines } from "./transcript-highlight";

// Shape captured from the highlighter the syntax route uses, for
// "# Title\n\n- item": one array element per source line, wrapper tags on the
// first and last.
const BLOCK = [
  `<pre class="shiki" style="color:#1f2328" tabindex="0"><code><span class="line"><span style="color:#0550AE">Title</span></span>`,
  `<span class="line"></span>`,
  `<span class="line"><span style="color:#953800">-</span><span style="color:#1F2328"> item</span></span></code></pre>`,
];

describe("highlightedLines", () => {
  it("peels the wrapper off so lines index-align with the source", () => {
    expect(highlightedLines(BLOCK)).toMatchInlineSnapshot(`
      [
        "<span class="line"><span style="color:#0550AE">Title</span></span>",
        "<span class="line"></span>",
        "<span class="line"><span style="color:#953800">-</span><span style="color:#1F2328"> item</span></span>",
      ]
    `);
  });

  it("handles a single-line block, where both wrappers are on one element", () => {
    expect(
      highlightedLines([
        `<pre><code><span class="line">solo</span></code></pre>`,
      ]),
    ).toMatchInlineSnapshot(`
        [
          "<span class="line">solo</span>",
        ]
      `);
  });

  // Rendering a block whose shape we no longer recognize would put raw markup
  // into the transcript; falling back to plain text just loses the color.
  it.each([
    ["nothing", undefined],
    ["an empty block", []],
    ["a block with no wrapper", [`<span class="line">bare</span>`]],
  ])("returns undefined for %s", (_label, block) => {
    expect(highlightedLines(block)).toBeUndefined();
  });
});
