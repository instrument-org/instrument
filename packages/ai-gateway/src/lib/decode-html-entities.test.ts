import { describe, expect, it } from "vitest";

import { decodeHtmlEntities } from "./decode-html-entities";

describe("decodeHtmlEntities", () => {
  it("leaves plain text unchanged", () => {
    expect(decodeHtmlEntities("hello && world")).toBe("hello && world");
  });

  it("decodes named entities used by Grok in shell commands", () => {
    expect(decodeHtmlEntities("cd /tmp &amp;&amp; uv add x")).toBe(
      "cd /tmp && uv add x",
    );
    expect(decodeHtmlEntities("cat &gt; f &lt;&lt; EOF")).toBe(
      "cat > f << EOF",
    );
  });

  it("decodes numeric character references", () => {
    expect(decodeHtmlEntities("a&#10;b")).toBe("a\nb");
    expect(decodeHtmlEntities("&#x0a;")).toBe("\n");
  });

  it("decodes double-encoded sequences", () => {
    expect(decodeHtmlEntities("&amp;lt;tag&amp;gt;")).toBe("<tag>");
  });
});
