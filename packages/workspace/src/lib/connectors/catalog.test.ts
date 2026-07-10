import { describe, expect, it } from "vitest";

import { catalogEntrySupportsApiKey, getConnectorCatalog } from "./catalog";

describe("connector catalog", () => {
  it("parses the seed catalog with well-formed entries", () => {
    const catalog = getConnectorCatalog();
    expect(catalog.length).toBeGreaterThan(5);
    for (const entry of catalog) {
      expect(entry.slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.interfaces.length).toBeGreaterThan(0);
    }
  });

  it("includes the flagship connectors", () => {
    const slugs = getConnectorCatalog().map((entry) => entry.slug);
    expect(slugs).toContain("linear");
    expect(slugs).toContain("notion");
    expect(slugs).toContain("github");
  });

  it("flags which entries have a simple API-key path", () => {
    const catalog = getConnectorCatalog();
    const linear = catalog.find((entry) => entry.slug === "linear");
    const spotify = catalog.find((entry) => entry.slug === "spotify");
    expect(linear && catalogEntrySupportsApiKey(linear)).toBe(true);
    // Spotify is OAuth-only.
    expect(spotify && catalogEntrySupportsApiKey(spotify)).toBe(false);
  });
});
