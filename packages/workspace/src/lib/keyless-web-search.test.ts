import { afterEach, describe, expect, it, vi } from "vitest";

import { parseResults, searchKeyless } from "./keyless-web-search";

function toolResult(result: object) {
  return new Response(
    `event: message\ndata: ${JSON.stringify({ id: 1, jsonrpc: "2.0", result })}\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

const rateLimited = () =>
  toolResult({
    _meta: { "ai.exa/rateLimited": true },
    content: [{ text: "You've hit Exa's free MCP rate limit.", type: "text" }],
  });

const found = () =>
  toolResult({
    content: [
      {
        text: "Title: One\nURL: https://one.test\nHighlights:\nA.",
        type: "text",
      },
    ],
  });

function search() {
  return searchKeyless({
    appVersion: "1.2.3",
    query: "what changed",
    signal: new AbortController().signal,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("parseResults", () => {
  it("reads each page's fields and passages", () => {
    expect(
      parseResults(
        [
          "Title: Frozen Trail - 2.0 Update\nURL: https://arcraiders.com/news/frozen-trail\nPublished: 2026-10-08T09:00:00.000Z\nAuthor: N/A\nHighlights:\nFirst passage.\n...\nSecond passage.",
          "Title: N/A\nURL: https://two.test\nPublished: N/A\nAuthor: Someone\nText: The whole text.",
          "Title: No address\nHighlights:\nDropped.",
        ].join("\n\n---\n\n"),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "author": undefined,
          "publishedDate": "2026-10-08T09:00:00.000Z",
          "text": "First passage.
      ...
      Second passage.",
          "title": "Frozen Trail - 2.0 Update",
          "url": "https://arcraiders.com/news/frozen-trail",
        },
        {
          "author": "Someone",
          "publishedDate": undefined,
          "text": "The whole text.",
          "title": undefined,
          "url": "https://two.test",
        },
      ]
    `);
  });

  it("reads no results from the empty-result message", () => {
    expect(
      parseResults("No search results found. Please try a different query."),
    ).toEqual([]);
  });
});

describe("searchKeyless", () => {
  it("names the app and its version", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(found());

    await search();

    expect(
      new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get("user-agent"),
    ).toBe("Instrument/1.2.3");
  });

  it("retries once when the free tier turns a call away", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(found());

    const pending = search();
    await vi.runAllTimersAsync();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect((await pending)._unsafeUnwrap().map((r) => r.url)).toEqual([
      "https://one.test",
    ]);
  });

  it("gives up after the retry is turned away too", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(new Response("", { status: 429 })),
      );

    const pending = search();
    await vi.runAllTimersAsync();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect((await pending)._unsafeUnwrapErr()).toBe(
      "The free web search is busy right now.",
    );
  });

  it("does not retry a failure that is not a rate limit", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      toolResult({
        content: [{ text: "Search failed.", type: "text" }],
        isError: true,
      }),
    );

    expect((await search())._unsafeUnwrapErr()).toBe("Search failed.");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
