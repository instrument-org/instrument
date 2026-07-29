import { describe, expect, it } from "vitest";

import { readWebSearchResults } from "./web-search-results";

describe("readWebSearchResults", () => {
  it("reads excerpts", () => {
    expect(
      readWebSearchResults({
        results: {
          costDollars: 0.007,
          kind: "excerpts",
          sources: [
            {
              publishedDate: "2026-07-01",
              text: "The passage that matched.",
              title: "One",
              url: "https://one.test",
            },
          ],
        },
        state: "success",
      }),
    ).toMatchInlineSnapshot(`
      {
        "kind": "excerpts",
        "sources": [
          {
            "publishedDate": "2026-07-01",
            "text": "The passage that matched.",
            "title": "One",
            "url": "https://one.test",
          },
        ],
      }
    `);
  });

  it("reads a summary", () => {
    expect(
      readWebSearchResults({
        results: {
          kind: "summary",
          modelId: "sonar",
          provider: { displayName: "Test", id: "test", type: "openai" },
          sources: [{ title: "One", url: "https://one.test" }],
          text: "What the search model wrote.",
          usage: {},
        },
        state: "success",
      }),
    ).toMatchInlineSnapshot(`
      {
        "kind": "summary",
        "sources": [
          {
            "title": "One",
            "url": "https://one.test",
          },
        ],
        "text": "What the search model wrote.",
      }
    `);
  });

  // Parts are cast rather than parsed on the way out of the store, so whatever
  // a past build wrote arrives typed as today's shape. Saying so is what stops
  // a caller reading a field that was never stored.
  it.each([
    {
      name: "a search recorded before results were nested",
      output: {
        sources: [{ title: "One", url: "https://one.test" }],
        state: "success",
        text: "What the search model wrote.",
      },
    },
    {
      name: "results whose kind this build does not know",
      output: { results: { kind: "spans", sources: [] }, state: "success" },
    },
    { name: "a bare string", output: "results" },
    { name: "output carrying no results", output: { state: "success" } },
  ])("reports $name as unreadable", ({ output }) => {
    expect(readWebSearchResults(output)).toBeNull();
  });
});
