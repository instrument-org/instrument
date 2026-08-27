// cspell:ignore dataframe
import { renderWithProviders } from "@/tests/render";
import { describe, expect, it } from "vitest";

import { NotebookHtml } from "./notebook-html";

/**
 * This is the notebook viewer's containment boundary: it decides what markup
 * from an untrusted `.ipynb` reaches the page. jsdom is enough to see all of
 * it, because every question here is about what ends up in the DOM rather than
 * about how it looks once there.
 */
function sanitize(html: string): HTMLElement {
  return renderWithProviders(<NotebookHtml html={html} />).container;
}

describe("NotebookHtml", () => {
  it("renders the table a DataFrame arrives as", () => {
    const container = sanitize(
      '<table class="dataframe"><thead><tr><th>alpha</th></tr></thead>' +
        "<tbody><tr><td>1</td></tr></tbody></table>",
    );

    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("th")?.textContent).toBe("alpha");
    expect(container.querySelector("td")?.textContent).toBe("1");
  });

  it.each([
    ["script", "<script>window.stolen = 1</script>"],
    ["style", "<style>body { display: none }</style>"],
    ["svg", "<svg><script>window.stolen = 1</script></svg>"],
    ["iframe", "<iframe src='https://example.com'></iframe>"],
    ["form", "<form><input name='password'></form>"],
  ])("drops a %s element and everything inside it", (tag, html) => {
    const container = sanitize(`<p>kept</p>${html}`);

    expect(container.querySelector(tag)).toBeNull();
    expect(container.textContent).toBe("kept");
  });

  it("strips class and style, so markup cannot paint over the app", () => {
    const container = sanitize(
      '<div class="fixed inset-0 z-50" style="position:fixed">overlay</div>',
    );

    const div = container.querySelector("div:not([class]):not([style])");
    expect(div?.textContent).toBe("overlay");
    expect(container.innerHTML).not.toContain("inset-0");
    expect(container.innerHTML).not.toContain("position:fixed");
  });

  it("drops event handler attributes", () => {
    const container = sanitize('<p onclick="window.stolen = 1">text</p>');

    expect(container.querySelector("p")?.getAttribute("onclick")).toBeNull();
  });

  describe("images", () => {
    it("keeps a data URI, which is how notebook images arrive", () => {
      const container = sanitize('<img alt="plot" src="data:image/png;base64,QUJD">');

      expect(container.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/png;base64,QUJD",
      );
    });

    it.each([
      ["a remote host, which would phone home on open", "https://tracker.test/p.png"],
      ["plain http", "http://tracker.test/p.png"],
      ["a javascript URL", "javascript:alert(1)"],
      ["a non-image data URI", "data:text/html,<script>alert(1)</script>"],
    ])("drops an image pointing at %s", (_label, src) => {
      expect(sanitize(`<img src="${src}">`).querySelector("img")).toBeNull();
    });
  });

  describe("links", () => {
    it("keeps an http link", () => {
      const container = sanitize('<a href="https://example.test/x">docs</a>');

      expect(container.querySelector("a")?.getAttribute("href")).toBe(
        "https://example.test/x",
      );
    });

    it("unwraps a link it will not follow, keeping the words", () => {
      const container = sanitize('<a href="javascript:alert(1)">click me</a>');

      expect(container.querySelector("a")).toBeNull();
      expect(container.textContent).toBe("click me");
    });
  });

  describe("table cells", () => {
    it("carries colspan and rowspan across", () => {
      const container = sanitize(
        '<table><tr><td colspan="2" rowspan="3">x</td></tr></table>',
      );

      const cell = container.querySelector("td");
      expect(cell?.getAttribute("colspan")).toBe("2");
      expect(cell?.getAttribute("rowspan")).toBe("3");
    });

    it("ignores a span that is not a positive number", () => {
      const container = sanitize('<table><tr><td colspan="nonsense">x</td></tr></table>');

      expect(container.querySelector("td")?.getAttribute("colspan")).toBeNull();
    });
  });

  it("unwraps a tag the allow-list does not know, keeping its content", () => {
    // Unlisted rather than dangerous: the words were still output, so the
    // element goes and the text stays.
    const container = sanitize("<section><p>inside</p></section>");

    expect(container.querySelector("section")).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe("inside");
  });

  it("drops the whitespace between table tags React would reject", () => {
    // A pandas repr arrives formatted like this, and a text node directly
    // inside `<table>` makes React log a DOM-nesting error for every one.
    const container = sanitize(
      "<table>\n  <thead>\n    <tr>\n      <th>a</th>\n    </tr>\n  </thead>\n</table>",
    );

    for (const tag of ["table", "thead", "tr"]) {
      const element = container.querySelector(tag);
      const texts = [...(element?.childNodes ?? [])].filter(
        (child) => child.nodeType === Node.TEXT_NODE,
      );
      expect(texts).toEqual([]);
    }
    expect(container.querySelector("th")?.textContent).toBe("a");
  });

  it("keeps whitespace that is content rather than formatting", () => {
    expect(sanitize("<td>a b</td>").textContent).toBe("a b");
  });

  it("stops descending past its depth cap", () => {
    // A few times the cap is all it takes to show the cap holds, and the real
    // input this guards against -- nesting deep enough to overflow a stack --
    // is not worth building here: jsdom's parser takes seconds over it, which
    // would be the slowest test in the suite for no extra coverage.
    const depth = 400;
    const container = sanitize(
      `${"<div>".repeat(depth)}bottom${"</div>".repeat(depth)}`,
    );

    let rendered = 0;
    let cursor = container.querySelector("div")?.firstElementChild ?? null;
    while (cursor) {
      rendered += 1;
      cursor = cursor.firstElementChild;
    }
    expect(rendered).toBeLessThan(depth);
  });
});
