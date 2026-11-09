import { describe, expect, it } from "vitest";

import { pageTitle } from "./page-title";

describe("pageTitle", () => {
  it.each([
    ["<title>Pricing &amp; plans</title><h1>Other</h1>", "Pricing & plans"],
    ["<title>  </title><h1>Only the <em>heading</em></h1>", "Only the heading"],
    ["<head><title>\n  Two\n  lines\n</title>", "Two lines"],
    ["<title>Q&#8217;s &#x2014; notes</title>", "Q’s — notes"],
    ["<svg><title>An icon</title></svg><title>The page</title>", "The page"],
    [
      "<script>document.title = '<title>No</title>'</script><h1>Yes</h1>",
      "Yes",
    ],
    [
      '<meta property="og:title" content="Shared &amp; named"><h1>Heading</h1>',
      "Shared & named",
    ],
    [
      "<meta content='Card title' name=twitter:title><h1>Heading</h1>",
      "Card title",
    ],
    [
      '<meta name="twitter:title" content="Card"><meta property="og:title" content="Graph">',
      "Graph",
    ],
    [
      '<title>owner/repo: A tool</title><body><h2 class="sr-only">Navigation Menu</h2><h1>repo</h1>',
      "owner/repo: A tool",
    ],
    ["<p>No title at all</p>", undefined],
  ])("%j reads as %j", (html, title) => {
    expect(pageTitle(html)).toBe(title);
  });
});
