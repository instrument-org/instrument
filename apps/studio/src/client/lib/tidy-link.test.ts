import { describe, expect, it } from "vitest";

import { tidyLink, titleLabel } from "./tidy-link";

describe("tidyLink", () => {
  it.each([
    ["https://react.dev/", "react.dev", false],
    [
      "https://www.amazon.com/dp/B004VCT1P8?th=1",
      "amazon.com/dp/B004VCT1P8?th=1",
      false,
    ],
    [
      "https://www.giro.com/product/fixture-mips-ii-youth-helmet/100000001400000351.html",
      "giro.com/product/fixture-mips-ii-youth",
      true,
    ],
    [
      "https://blog.sydorets.com/en/posts/steak/",
      "blog.sydorets.com/en/posts/steak",
      false,
    ],
    [
      "https://fr.wikipedia.org/wiki/Caf%C3%A9_de_Flore",
      "fr.wikipedia.org/wiki/Café_de_Flore",
      false,
    ],
    // A space and a direction override stay escaped.
    [
      "https://example.com/a%20b/%E2%80%AEtxt",
      "example.com/a%20b/%E2%80%AEtxt",
      false,
    ],
  ])("shows %s as %s", (href, shown, cut) => {
    expect(tidyLink(href, href)).toMatchObject({ cut, shown });
  });

  it("shows escaped parentheses as themselves", () => {
    const href =
      "https://commons.wikimedia.org/wiki/File:Joseph_Severn_%281793-1879%29_-_Ariel.jpg";
    expect(tidyLink(href, href)).toEqual({
      cut: true,
      shown: "commons.wikimedia.org/wiki/File:Joseph_Severn_(1793",
    });
  });

  it("tidies a www. link the parser gave a scheme", () => {
    expect(tidyLink("http://www.nytimes.com", "www.nytimes.com")).toEqual({
      cut: false,
      shown: "nytimes.com",
    });
  });

  it.each([
    ["words someone chose", "https://example.com/page", "the page"],
    ["a mail link", "mailto:a@example.com", "mailto:a@example.com"],
    ["an app link", "instrument://chat/x", "instrument://chat/x"],
    [
      "an address with a user in it",
      "https://github.com@evil.test/x",
      "https://github.com@evil.test/x",
    ],
  ])("leaves %s alone", (_, href, label) => {
    expect(tidyLink(href, label)).toBeUndefined();
  });
});

describe("titleLabel", () => {
  it.each([
    [
      "Amazon.com: Voss Artesian Water (Still) Glass Bottles, 27.1-Ounce (Pack of 6) : Grocery & Gourmet Food",
      "https://www.amazon.com/dp/B004VCT1P8",
      "Voss Artesian Water (Still) Glass Bottles, 27.1-Ounce (Pack of 6) : Grocery &…",
    ],
    [
      "The Best Chili Recipe | Serious Eats",
      "https://www.seriouseats.com/chili",
      "The Best Chili Recipe",
    ],
    [
      "Fix the login loop · Issue #12 · acme/app · GitHub",
      "https://github.com/acme/app/issues/12",
      "Fix the login loop · Issue #12 · acme/app",
    ],
    [
      "Café de Flore - Wikipedia",
      "https://fr.wikipedia.org/wiki/Caf%C3%A9_de_Flore",
      "Café de Flore",
    ],
    // A colon inside the title, with no site name around it, stays.
    [
      "Ask HN: What are you working on?",
      "https://news.ycombinator.com/item?id=1",
      "Ask HN: What are you working on?",
    ],
    ["Serious Eats", "https://www.seriouseats.com/", "Serious Eats"],
  ])("labels %s", (title, href, label) => {
    expect(titleLabel(title, href)).toBe(label);
  });
});
