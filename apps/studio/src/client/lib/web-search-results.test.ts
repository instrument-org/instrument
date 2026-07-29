import { describe, expect, it } from "vitest";

import { parseWebSearchResults } from "./web-search-results";

describe("parseWebSearchResults", () => {
  it.each([
    {
      name: "the excerpts a search returns now",
      output: {
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
      },
    },
    {
      name: "a transcript whose pages carried spans instead of one passage",
      output: {
        costDollars: 0.007,
        sources: [
          {
            highlights: ["The passage that matched."],
            publishedDate: "2026-07-01",
            title: "One",
            url: "https://one.test",
          },
        ],
        state: "success",
        text: "### 1. One",
      },
    },
  ])("reads $name as excerpts", ({ output }) => {
    expect(parseWebSearchResults(output)).toMatchInlineSnapshot(`
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

  it.each([
    {
      name: "the summary a provider model returns now",
      output: {
        results: {
          kind: "summary",
          modelId: "sonar",
          provider: { displayName: "Test", id: "test", type: "openai" },
          sources: [{ title: "One", url: "https://one.test" }],
          text: "What the search model wrote.",
          usage: {},
        },
        state: "success",
      },
    },
    {
      name: "a transcript recorded before the tool could return excerpts",
      output: {
        modelId: "sonar",
        provider: { displayName: "Test", id: "test", type: "openai" },
        sources: [{ title: "One", url: "https://one.test" }],
        state: "success",
        text: "What the search model wrote.",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    },
  ])("reads $name as a summary", ({ output }) => {
    expect(parseWebSearchResults(output)).toMatchInlineSnapshot(`
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

  it.each([
    { name: "a bare string", output: "results" },
    { name: "an output with no results at all", output: { state: "success" } },
  ])("returns null for $name rather than throwing", ({ output }) => {
    expect(parseWebSearchResults(output)).toBeNull();
  });
});
