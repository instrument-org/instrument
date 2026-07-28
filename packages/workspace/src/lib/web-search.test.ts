import { describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../schemas/task-id";
import { type WebSearchClient } from "../schemas/web-search";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { webSearch } from "./web-search";
import { getWorkspaceConfig } from "./workspace-config";

describe("webSearch", () => {
  it("returns ranked excerpts and source metadata from the platform API", async () => {
    const client = vi.fn<WebSearchClient>(() =>
      Promise.resolve({
        data: {
          costDollars: 0.007,
          results: [
            {
              author: "TypeScript Team",
              highlights: ["First excerpt.", "Second excerpt."],
              publishedDate: "2026-07-28T00:00:00.000Z",
              title: "TypeScript release notes",
              url: "https://example.com/typescript",
            },
            {
              highlights: [],
              url: "https://example.com/untitled",
            },
          ],
        },
        ok: true,
      }),
    );
    createMockTaskConfig(TaskIdSchema.parse("2026-07-28-web-search"), {
      webSearch: client,
    });
    const signal = new AbortController().signal;

    const result = await webSearch({
      prompt: "latest TypeScript release",
      signal,
      workspaceConfig: getWorkspaceConfig(),
    });

    expect(client).toHaveBeenCalledWith({
      input: { query: "latest TypeScript release" },
      signal,
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "data": {
          "costDollars": 0.007,
          "sources": [
            {
              "author": "TypeScript Team",
              "highlights": [
                "First excerpt.",
                "Second excerpt.",
              ],
              "publishedDate": "2026-07-28T00:00:00.000Z",
              "title": "TypeScript release notes",
              "url": "https://example.com/typescript",
            },
            {
              "highlights": [],
              "url": "https://example.com/untitled",
            },
          ],
          "text": "### 1. TypeScript release notes

      Published or updated: 2026-07-28T00:00:00.000Z
      Author: TypeScript Team

      First excerpt.

      Second excerpt.

      ### 2. Untitled result",
        },
        "ok": true,
      }
    `);
  });

  it("preserves platform API failures", async () => {
    createMockTaskConfig(TaskIdSchema.parse("2026-07-28-web-search-failure"), {
      webSearch: () =>
        Promise.resolve({
          errorMessage: "Sign in to Instrument to search the web.",
          errorType: "not-authenticated",
          ok: false,
        }),
    });

    const result = await webSearch({
      prompt: "current news",
      signal: new AbortController().signal,
      workspaceConfig: getWorkspaceConfig(),
    });

    expect(result).toMatchInlineSnapshot(`
      {
        "errorMessage": "Sign in to Instrument to search the web.",
        "errorType": "not-authenticated",
        "ok": false,
      }
    `);
  });
});
