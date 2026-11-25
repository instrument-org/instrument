import { describe, expect, it } from "vitest";

import { pageRows } from "./page-rows";

const pages = [
  { title: "Hacker News", url: "https://news.ycombinator.com/" },
  { title: "Pull requests", url: "https://github.com/acme/app/pulls" },
  { title: "Help desk pricing", url: "https://zendesk.com/pricing" },
].map((page) => ({ ...page, favicon: undefined }));

const found = (words: string) =>
  pageRows({ pages, words }).map(({ address, addressRanges, titleRanges }) => ({
    address,
    addressRanges,
    titleRanges,
  }));

describe("pages several words find", () => {
  it("needs every word, in any order, and marks each", () => {
    expect(found("news hacker")).toMatchInlineSnapshot(`
      [
        {
          "address": "news.ycombinator.com",
          "addressRanges": [
            0,
            4,
          ],
          "titleRanges": [
            0,
            6,
            7,
            11,
          ],
        },
      ]
    `);
    expect(found("pull git")).toMatchInlineSnapshot(`
      [
        {
          "address": "github.com/acme/app/pulls",
          "addressRanges": [
            0,
            3,
            20,
            24,
          ],
          "titleRanges": [
            0,
            4,
          ],
        },
      ]
    `);
    expect(found("pull zendesk")).toEqual([]);
  });

  it("joins marks that overlap", () => {
    expect(found("pri pricing")).toMatchInlineSnapshot(`
      [
        {
          "address": "zendesk.com/pricing",
          "addressRanges": [
            12,
            19,
          ],
          "titleRanges": [
            10,
            17,
          ],
        },
      ]
    `);
  });
});
