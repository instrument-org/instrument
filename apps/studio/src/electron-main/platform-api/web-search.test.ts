import { beforeEach, describe, expect, it, vi } from "vitest";

import { getToken } from "./utils";
import { searchWeb } from "./web-search";

vi.mock(import("./headers"), () => ({
  getPlatformApiHeaders: () => ({
    authorization: "Bearer test-token",
    "x-client-arch": process.arch,
    "x-client-name": "studio",
    "x-client-os-version": "15.6",
    "x-client-platform": process.platform,
    "x-client-version": "1.4.2",
  }),
}));
vi.mock(import("./utils"), () => ({
  getToken: vi.fn(),
}));

const mockGetToken = vi.mocked(getToken);

describe("searchWeb", () => {
  beforeEach(() => {
    mockGetToken.mockReturnValue("test-token");
  });

  it("requires an Instrument account before making a request", async () => {
    mockGetToken.mockReturnValue(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await searchWeb({
      input: { query: "latest TypeScript release" },
      signal: new AbortController().signal,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchInlineSnapshot(`
      {
        "errorMessage": "Sign in to Instrument to search the web.",
        "errorType": "not-authenticated",
        "ok": false,
      }
    `);
  });

  it("posts the query and validates ranked search results", async () => {
    const signal = new AbortController().signal;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        costDollars: 0.007,
        results: [
          {
            publishedDate: "2026-07-28",
            text: "TypeScript release details.",
            title: "TypeScript",
            url: "https://example.com/typescript",
          },
        ],
      }),
    );

    const result = await searchWeb({
      input: { query: "latest TypeScript release" },
      signal,
    });

    expect(fetchSpy).toHaveBeenCalledWith(expect.stringMatching(/\/search$/), {
      body: JSON.stringify({ query: "latest TypeScript release" }),
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
        "x-client-arch": process.arch,
        "x-client-name": "studio",
        "x-client-os-version": "15.6",
        "x-client-platform": process.platform,
        "x-client-version": "1.4.2",
      },
      method: "POST",
      signal,
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "data": {
          "costDollars": 0.007,
          "results": [
            {
              "publishedDate": "2026-07-28",
              "text": "TypeScript release details.",
              "title": "TypeScript",
              "url": "https://example.com/typescript",
            },
          ],
        },
        "ok": true,
      }
    `);
  });

  it("preserves platform API failures for the tool card", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Out of credits" }), {
        status: 402,
      }),
    );

    const result = await searchWeb({
      input: { query: "current news" },
      signal: new AbortController().signal,
    });

    expect(result).toMatchInlineSnapshot(`
      {
        "errorMessage": "Out of credits",
        "errorType": "payment-required",
        "ok": false,
        "responseBody": "{"error":"Out of credits"}",
      }
    `);
  });

  // The workspace only falls back to a provider's own search for failures the
  // user cannot act on, so these statuses have to stay distinguishable.
  it.each([
    { errorType: "not-authenticated", status: 401 },
    { errorType: "payment-required", status: 402 },
    { errorType: "request-failed", status: 429 },
    { errorType: "request-failed", status: 503 },
  ])("reports HTTP $status as $errorType", async ({ errorType, status }) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "nope" }), { status }),
    );

    const result = await searchWeb({
      input: { query: "current news" },
      signal: new AbortController().signal,
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errorType).toBe(errorType);
  });

  it("rejects an unexpected success payload", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ results: "not-an-array" }),
    );

    const result = await searchWeb({
      input: { query: "current news" },
      signal: new AbortController().signal,
    });

    expect(result).toMatchInlineSnapshot(`
      {
        "errorMessage": "Web search returned an unexpected response.",
        "errorType": "request-failed",
        "ok": false,
        "responseBody": "{"results":"not-an-array"}",
      }
    `);
  });

  it("rejects a non-JSON success payload", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not JSON"));

    const result = await searchWeb({
      input: { query: "current news" },
      signal: new AbortController().signal,
    });

    expect(result).toMatchInlineSnapshot(`
      {
        "errorMessage": "Web search returned an unexpected response.",
        "errorType": "request-failed",
        "ok": false,
        "responseBody": "not JSON",
      }
    `);
  });
});
