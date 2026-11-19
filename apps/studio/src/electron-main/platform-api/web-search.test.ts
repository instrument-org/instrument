import { type HostedRelease } from "@instrument-org/ai-gateway";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hostedLimiter } from "@/electron-main/lib/hosted-limiter";

import { getToken } from "./utils";
import { searchWeb } from "./web-search";

vi.mock(import("./headers"), () => ({
  getPlatformApiHeaders: () => ({
    authorization: "Bearer test-token",
    "user-agent": "Instrument/1.4.2",
    "x-client-arch": process.arch,
    "x-client-name": "studio",
    "x-client-os-version": "15.6",
    "x-client-platform": process.platform,
    "x-client-version": "1.4.2",
  }),
}));
vi.mock(import("@/electron-main/lib/system-country"), () => ({
  systemCountry: () => "US",
}));
vi.mock(import("./utils"), () => ({
  getToken: vi.fn(),
}));
vi.mock(import("@/electron-main/lib/hosted-limiter"), () => ({
  hostedLimiter: {
    acquire: vi.fn(),
    setLimits: vi.fn(),
    snapshot: () => ({ ceiling: 8, inFlight: 0, queued: 0 }),
  },
}));

const mockGetToken = vi.mocked(getToken);
const mockAcquire = vi.mocked(hostedLimiter.acquire);
const release = vi.fn<HostedRelease>();

describe("searchWeb", () => {
  beforeEach(() => {
    mockGetToken.mockReturnValue("test-token");
    mockAcquire.mockResolvedValue(release);
  });

  it("waits for a slot in the chat's queue, and frees it once answered", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ results: [] }),
    );
    const signal = new AbortController().signal;

    await searchWeb({
      input: { query: "weather" },
      sessionId: "ses_1",
      signal,
    });

    expect(mockAcquire).toHaveBeenCalledWith({ key: "ses_1", signal });
    expect(release).toHaveBeenCalledExactlyOnceWith({ refusal: undefined });
  });

  it("tells the limiter which code the platform refused the search with", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { error: { code: "concurrency-limit", message: "Too many" } },
        { status: 429 },
      ),
    );

    const result = await searchWeb({
      input: { query: "weather" },
      sessionId: "ses_1",
      signal: new AbortController().signal,
    });

    expect(result.ok).toBe(false);
    expect(release).toHaveBeenCalledExactlyOnceWith({
      refusal: "concurrency-limit",
    });
  });

  it("sends nothing for a search canceled while it waited", async () => {
    mockAcquire.mockRejectedValue(
      new DOMException("The request was aborted.", "AbortError"),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await searchWeb({
      input: { query: "weather" },
      sessionId: "ses_1",
      signal: AbortSignal.abort(),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchInlineSnapshot(`
      {
        "errorMessage": "Web search was cancelled.",
        "errorType": "request-failed",
        "ok": false,
      }
    `);
  });

  it("requires an Instrument account before making a request", async () => {
    mockGetToken.mockReturnValue(undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await searchWeb({
      input: { query: "latest TypeScript release" },
      sessionId: "ses_1",
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
      sessionId: "ses_1",
      signal,
    });

    expect(fetchSpy).toHaveBeenCalledWith(expect.stringMatching(/\/search$/), {
      body: JSON.stringify({
        query: "latest TypeScript release",
        userLocation: "US",
      }),
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
        "user-agent": "Instrument/1.4.2",
        "x-client-arch": process.arch,
        "x-client-name": "studio",
        "x-client-os-version": "15.6",
        "x-client-platform": process.platform,
        "x-client-session-id": "ses_1",
        "x-client-version": "1.4.2",
      },
      method: "POST",
      signal,
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "data": {
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
      sessionId: "ses_1",
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
      sessionId: "ses_1",
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
      sessionId: "ses_1",
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
      sessionId: "ses_1",
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
