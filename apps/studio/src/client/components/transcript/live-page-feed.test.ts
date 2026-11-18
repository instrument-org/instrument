import { describe, expect, it } from "vitest";

import {
  feedPage,
  foundationPlace,
  NEW_FEED,
  type PageFeed,
} from "./live-page-feed";

const SKILL_PAGE = `<!doctype html>
<!-- direction: reader="Ben" point="Two of three costs are ours" -->
<html lang="en" data-layout="wide">
  <head>
    <title>Two of three costs are ours</title>
  </head>
  <body>
    <header><hgroup><p>For Ben</p><h1>Two of three costs are ours</h1></hgroup></header>
    <section class="hero"><p class="stat"><b>11%</b><span>failed</span></p></section>
    <script>document.querySelector(".hero").dataset.drawn = "yes";</script>
  </body>
</html>
`;

const BUILT_PAGE = SKILL_PAGE.replace(
  "<head>\n",
  "<head>\n<!-- foundation:start (written by page.mjs) -->\n<style></style>\n<!-- foundation:end -->\n",
);

const PLAIN_PAGE = `<!doctype html>
<html><head><title>Plain</title></head><body><h1>Plain</h1></body></html>`;

/**
 * A document as a feed writes it, `@` standing for the foundation: what the
 * writes since the last open come to, and how often it was opened and closed.
 */
function document() {
  let text = "";
  let opens = 0;
  let closes = 0;
  let feed: PageFeed = NEW_FEED;
  return {
    get closes() {
      return closes;
    },
    feed(source: string, isComplete = false) {
      const step = feedPage(feed, source, isComplete);
      feed = step.feed;
      if (step.open) {
        opens++;
        text = "";
      }
      text += step.pieces.map((piece) => piece ?? "@").join("");
      if (step.close) {
        closes++;
      }
    },
    get opens() {
      return opens;
    },
    get text() {
      return text;
    },
  };
}

/** The source cut into pieces of `size`, each arriving with all before it. */
function arriving(source: string, size: number) {
  const prefixes = [];
  for (let end = size; end < source.length; end += size) {
    prefixes.push(source.slice(0, end));
  }
  return [...prefixes, source];
}

describe("feeding a page as it arrives", () => {
  it.each([1, 7, 64, 4096])(
    "writes in pieces of %i what one write of the whole would",
    (size) => {
      const whole = document();
      whole.feed(SKILL_PAGE, true);
      const streamed = document();
      for (const source of arriving(SKILL_PAGE, size)) {
        streamed.feed(source);
      }
      streamed.feed(SKILL_PAGE, true);
      expect(streamed.text).toBe(whole.text);
      expect(streamed.opens).toBe(1);
      expect(streamed.closes).toBe(1);
    },
  );

  it("puts the foundation straight after a skill page's head", () => {
    const page = document();
    page.feed(SKILL_PAGE, true);
    expect(page.text.slice(0, page.text.indexOf("<title>")))
      .toMatchInlineSnapshot(`
        "<!doctype html>
        <!-- direction: reader="Ben" point="Two of three costs are ours" -->
        <html lang="en" data-layout="wide">
          <head>@
            "
      `);
  });

  it("leaves out the foundation for a page that has its own, or is no skill page", () => {
    for (const source of [BUILT_PAGE, PLAIN_PAGE]) {
      const page = document();
      for (const part of arriving(source, 5)) {
        page.feed(part);
      }
      expect(page.text).toBe(source);
    }
  });

  it("holds back the start until it knows where the foundation goes", () => {
    const head = SKILL_PAGE.indexOf("<head>") + "<head>".length;
    const page = document();
    page.feed(SKILL_PAGE.slice(0, head));
    expect(page.text).toBe("");
    expect(page.opens).toBe(1);
    // The next characters could still be a built page's own block.
    page.feed(SKILL_PAGE.slice(0, head + 6));
    expect(page.text).toBe("");
    page.feed(SKILL_PAGE.slice(0, head + 7));
    expect(page.text).toBe(`${SKILL_PAGE.slice(0, head)}@\n    <t`);
  });

  it("writes only what is new after that", () => {
    const page = document();
    page.feed(PLAIN_PAGE.slice(0, 40));
    const before = page.text;
    page.feed(PLAIN_PAGE.slice(0, 50));
    expect(page.text).toBe(before + PLAIN_PAGE.slice(40, 50));
  });

  it("opens afresh when the source stops extending what was written", () => {
    const page = document();
    page.feed(PLAIN_PAGE.slice(0, 60));
    page.feed("<!doctype html><body><p>Another start");
    expect(page.opens).toBe(2);
    expect(page.text).toBe("<!doctype html><body><p>Another start");
  });

  it("closes once, and writes nothing more for the same source", () => {
    const page = document();
    page.feed(PLAIN_PAGE, true);
    page.feed(PLAIN_PAGE, true);
    expect(page.closes).toBe(1);
    expect(page.opens).toBe(1);
  });
});

describe("where the foundation goes", () => {
  it.each([
    ["a skill page's head", SKILL_PAGE, SKILL_PAGE.indexOf("<head>") + 6],
    ["a built page", BUILT_PAGE, false],
    ["a plain page", PLAIN_PAGE, false],
    [
      "a skill page with no head, after its comment",
      '<!doctype html>\n<!-- direction: point="x" -->\n<body><h1>x</h1>',
      '<!doctype html>\n<!-- direction: point="x" -->'.length,
    ],
  ])("%s", (_name, source, place) => {
    expect(foundationPlace(source, false)).toBe(place);
  });

  it.each([
    ["the doctype alone", "<!doctype html>\n"],
    ["half a comment", "<!doctype html>\n<!-- direc"],
    ["a comment with no head yet", SKILL_PAGE.slice(0, 120)],
  ])("waits on %s", (_name, source) => {
    expect(foundationPlace(source, false)).toBeUndefined();
    expect(foundationPlace(source, true)).not.toBeUndefined();
  });
});
