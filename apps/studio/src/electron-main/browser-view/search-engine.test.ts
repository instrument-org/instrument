import { describe, expect, it, vi } from "vitest";

import { contactGoogle, suggestSearches } from "./search-engine";

function answering(body: unknown, init?: ResponseInit) {
  return { fetch: vi.fn(() => Promise.resolve(Response.json(body, init))) };
}

describe("suggestSearches", () => {
  it("asks without cookies and reads the engine's answer", async () => {
    const session = answering(["egg", ["eggs benedict", "egg salad"], [], {}]);
    const suggestions = await suggestSearches(session, {
      engine: "google",
      locale: "en-US",
      query: "egg",
    });
    expect(suggestions).toEqual(["eggs benedict", "egg salad"]);
    expect(session.fetch).toHaveBeenCalledWith(
      "https://www.google.com/complete/search?client=firefox&hl=en-US&oe=utf-8&q=egg",
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  it.each([
    ["duckduckgo", "https://duckduckgo.com/ac/?kl=us-en&q=egg&type=list"],
    ["bing", "https://api.bing.com/osjson.aspx?query=egg&language=en-US"],
    ["brave", "https://search.brave.com/api/suggest?q=egg"],
    ["kagi", "https://kagisuggest.com/api/autosuggest?q=egg"],
  ] as const)("asks %s at its own address", async (engine, url) => {
    const session = answering(["egg", ["eggs"]]);
    await suggestSearches(session, { engine, locale: "en-US", query: "egg" });
    expect(session.fetch).toHaveBeenCalledWith(url, expect.anything());
  });

  it("asks about nothing longer than a search", async () => {
    const session = answering(["egg", ["eggs"]]);
    const ask = (query: string) =>
      suggestSearches(session, { engine: "google", locale: "en-US", query });
    await ask("e".repeat(101));
    expect(session.fetch).not.toHaveBeenCalled();
    await ask("e".repeat(100));
    expect(session.fetch).toHaveBeenCalledOnce();
  });

  it.each([
    ["a refusal", answering("no", { status: 429 })],
    ["an answer in another shape", answering({ suggestions: ["eggs"] })],
    ["no network", { fetch: vi.fn(() => Promise.reject(new Error("off"))) }],
  ])("suggests nothing on %s", async (_case, session) => {
    await expect(
      suggestSearches(session, {
        engine: "google",
        locale: "en-US",
        query: "egg",
      }),
    ).resolves.toEqual([]);
  });
});

describe("contactGoogle", () => {
  it("settles with no network", async () => {
    const session = { fetch: vi.fn(() => Promise.reject(new Error("off"))) };
    await expect(contactGoogle(session)).resolves.toBeUndefined();
  });
});
