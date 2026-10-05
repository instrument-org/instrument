import { afterEach, describe, expect, it, vi } from "vitest";

import { TypedError } from "./errors";
import { fetchJson } from "./fetch-json";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJson", () => {
  it("keeps the status of a response that is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("Internal Server Error", {
            status: 500,
            statusText: "Internal Server Error",
          }),
      ),
    );

    const result = await fetchJson({
      cache: false,
      headers: new Headers(),
      url: "https://example.test/models",
    });

    expect(result.error).toBeInstanceOf(TypedError.Fetch);
    expect(result.error?.message).toMatchInlineSnapshot(
      `"Failed to fetch from https://example.test/models: 500 Internal Server Error"`,
    );
    expect(
      result.error instanceof TypedError.Fetch ? result.error.status : null,
    ).toBe(500);
  });
});
