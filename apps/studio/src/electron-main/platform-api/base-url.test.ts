import { describe, expect, it, vi } from "vitest";

vi.stubEnv("MAIN_VITE_APP_API_BASE_URL", "https://build.example");

const { platformApiBaseUrl, platformApiOrigin, settlePlatformApiServer } =
  await import("./base-url");

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
