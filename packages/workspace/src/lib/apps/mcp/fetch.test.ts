import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchForMcp } from "./fetch";

afterEach(() => {
  vi.unstubAllGlobals();
});

function refresh(token: string) {
  return fetchForMcp("https://auth.example/token", {
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token,
    }),
    method: "POST",
  });
}

describe("fetchForMcp", () => {
  it("shares one refresh among callers holding the same refresh token", async () => {
    let answer = 0;
    const fetchMock = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      answer += 1;
      return Response.json({ access_token: `at-${answer}` });
    });
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      refresh("rt-shared"),
      refresh("rt-shared"),
    ]);
    const late = await refresh("rt-shared");
    await refresh("rt-other");

    expect(await first.json()).toEqual({ access_token: "at-1" });
    expect(await second.json()).toEqual({ access_token: "at-1" });
    expect(await late.json()).toEqual({ access_token: "at-1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tries a refused refresh again rather than keeping the refusal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: "temporarily_unavailable" }, { status: 503 }),
      )
      .mockResolvedValueOnce(Response.json({ access_token: "at" }));
    vi.stubGlobal("fetch", fetchMock);

    expect((await refresh("rt-retry")).status).toBe(503);
    expect((await refresh("rt-retry")).status).toBe(200);
  });
});
