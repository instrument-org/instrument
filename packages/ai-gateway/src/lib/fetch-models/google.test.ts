import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIGatewayProviderConfig } from "../../schemas/provider-config";
import { clearCachedResults } from "../cache";
import { fetchAndParseGoogleModels } from "./google";

const googleConfig = AIGatewayProviderConfig.Schema.parse({
  apiKey: "test-key",
  cacheIdentifier: "test-google",
  id: "test-google-config-id",
  type: "google",
});

function googleModel(name: string) {
  return {
    displayName: name,
    inputTokenLimit: 1_000_000,
    name,
    outputTokenLimit: 65_536,
    supportedGenerationMethods: ["generateContent"],
    version: "001",
  };
}

describe("fetchAndParseGoogleModels", () => {
  beforeEach(() => {
    clearCachedResults();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows nextPageToken until the list is complete", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [googleModel("models/gemini-2.5-pro")],
            nextPageToken: "page-2",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ models: [googleModel("models/gemini-2.5-flash")] }),
          { status: 200 },
        ),
      );

    const result = await fetchAndParseGoogleModels(googleConfig);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.value.map((m) => m.canonicalId)).toEqual([
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ]);

    const requestedUrls = vi
      .mocked(fetch)
      .mock.calls.map(
        ([input]) => new URL(input instanceof Request ? input.url : input),
      );
    expect(requestedUrls[0]?.searchParams.get("pageSize")).toBe("1000");
    expect(requestedUrls[0]?.searchParams.get("pageToken")).toBeNull();
    expect(requestedUrls[1]?.searchParams.get("pageToken")).toBe("page-2");
  });

  it("returns a single page when there is no nextPageToken", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ models: [googleModel("models/gemini-2.5-pro")] }),
        { status: 200 },
      ),
    );

    const result = await fetchAndParseGoogleModels(googleConfig);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.value.map((m) => m.canonicalId)).toEqual(["gemini-2.5-pro"]);
  });
});
