import { describe, expect, it, vi } from "vitest";

// With a trailing slash, which the helper drops.
vi.stubEnv("MAIN_VITE_APP_API_BASE_URL", "https://build.example/");

const {
  platformApiBaseUrl,
  platformApiOrigin,
  settlePlatformApiServer,
  websiteBaseUrl,
} = await import("./base-url");

describe("platformApiBaseUrl", () => {
  it("is the build's own server until one is settled, then the settled one", () => {
    expect(platformApiBaseUrl()).toBe("https://build.example");

    settlePlatformApiServer("staging");

    expect(platformApiBaseUrl()).toBe("https://staging.api.tryinstrument.com");
    expect(platformApiOrigin()).toBe("https://staging.api.tryinstrument.com");
  });

  it("settles on the build's own server when nothing is chosen", () => {
    settlePlatformApiServer(undefined);

    expect(platformApiBaseUrl()).toBe("https://build.example");
  });
});

describe("websiteBaseUrl", () => {
  it.each([
    ["production", "https://tryinstrument.com"],
    ["staging", "https://staging.tryinstrument.com"],
    // The build's own server, which is neither.
    [undefined, "https://tryinstrument.com"],
  ] as const)("goes with %s", (server, website) => {
    settlePlatformApiServer(server);

    expect(websiteBaseUrl()).toBe(website);
  });
});
