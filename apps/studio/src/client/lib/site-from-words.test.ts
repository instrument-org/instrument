import { describe, expect, it } from "vitest";

import { siteFromWords } from "./site-from-words";

describe("siteFromWords", () => {
  it.each([
    {
      expected: { host: "example.com", url: "https://example.com/" },
      words: "example.com",
    },
    {
      expected: {
        host: "docs.example.com",
        url: "https://docs.example.com/a/b",
      },
      words: "docs.example.com/a/b",
    },
    {
      expected: { host: "localhost:3000", url: "http://localhost:3000/" },
      words: "http://localhost:3000",
    },
    {
      expected: { host: "example.com", url: "https://example.com/?q=1" },
      words: "https://example.com?q=1",
    },
  ])("reads $words as an address", ({ expected, words }) => {
    expect(siteFromWords(words)).toEqual(expected);
  });

  it.each([
    "",
    "lisbon",
    "what is on this page",
    "example.com is down",
    "localhost",
    "notion",
  ])("leaves %j to the conversation", (words) => {
    expect(siteFromWords(words)).toBeUndefined();
  });
});
