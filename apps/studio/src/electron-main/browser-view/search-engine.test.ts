import { describe, expect, it, vi } from "vitest";

import { contactSearchEngine, suggestSearches } from "./search-engine";

function answering(body: unknown, init?: ResponseInit) {
  return { fetch: vi.fn(() => Promise.resolve(Response.json(body, init))) };
}

describe("suggestSearches", () => {
  it("asks without cookies and reads the engine's answer", async () => {
    const session = answering(["egg", ["eggs benedict", "egg salad"], [], {}]);
    const suggestions = await suggestSearches(session, {
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
    ["a refusal", answering("no", { status: 429 })],
    ["an answer in another shape", answering({ suggestions: ["eggs"] })],
    ["no network", { fetch: vi.fn(() => Promise.reject(new Error("off"))) }],
  ])("suggests nothing on %s", async (_case, session) => {
    await expect(
      suggestSearches(session, { locale: "en-US", query: "egg" }),
    ).resolves.toEqual([]);
  });
});

describe("contactSearchEngine", () => {
  it("settles with no network", async () => {
    const session = { fetch: vi.fn(() => Promise.reject(new Error("off"))) };
    await expect(contactSearchEngine(session)).resolves.toBeUndefined();
  });
});
