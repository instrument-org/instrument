import { type AppFlavor } from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import {
  type PlatformApiServer,
  PlatformApiServerSchema,
  platformApiServerLabel,
  resolvePlatformApiBaseUrl,
} from "./platform-api-server";

const BUILD_DEFAULT = "https://build.example";
const DEVELOPMENT: AppFlavor = { kind: "development" };
const RELEASE: AppFlavor = { kind: "release" };
const PREVIEW: AppFlavor = { kind: "preview", name: "branch-1" };

function resolve(choice: PlatformApiServer | undefined, flavor: AppFlavor) {
  return resolvePlatformApiBaseUrl({
    buildDefault: BUILD_DEFAULT,
    choice,
    flavor,
  });
}

describe("resolvePlatformApiBaseUrl", () => {
  it.each([DEVELOPMENT, RELEASE, PREVIEW])(
    "uses the build's own server when nothing is chosen ($kind)",
    (flavor) => {
      expect(resolve(undefined, flavor)).toBe(BUILD_DEFAULT);
    },
  );

  it.each([DEVELOPMENT, RELEASE, PREVIEW])(
    "offers production and staging to every build ($kind)",
    (flavor) => {
      expect(resolve("production", flavor)).toBe(
        "https://api.tryinstrument.com",
      );
      expect(resolve("staging", flavor)).toBe(
        "https://staging.api.tryinstrument.com",
      );
    },
  );

  it("offers a local or typed-in server to a development build", () => {
    expect(resolve("local", DEVELOPMENT)).toBe("http://localhost:49100");
    expect(resolve({ custom: "http://10.0.0.5:8787/" }, DEVELOPMENT)).toBe(
      "http://10.0.0.5:8787",
    );
  });

  it.each([RELEASE, PREVIEW])(
    "falls back to the build's own server for a local or typed-in one ($kind)",
    (flavor) => {
      expect(resolve("local", flavor)).toBe(BUILD_DEFAULT);
      expect(resolve({ custom: "http://10.0.0.5:8787" }, flavor)).toBe(
        BUILD_DEFAULT,
      );
    },
  );
});

describe("PlatformApiServerSchema", () => {
  it.each([
    ["an unknown name", "qa"],
    ["an address that is not http(s)", { custom: "ftp://example.com" }],
    ["something that is not an address", { custom: "not a url" }],
  ])("refuses %s", (_name, value) => {
    expect(PlatformApiServerSchema.safeParse(value).success).toBe(false);
  });
});

describe("platformApiServerLabel", () => {
  it.each([
    ["https://api.tryinstrument.com", undefined],
    ["https://staging.api.tryinstrument.com", "Staging"],
    ["http://localhost:49100", "Local"],
    ["http://10.0.0.5:8787", "10.0.0.5:8787"],
  ])("calls %s %s", (baseUrl, label) => {
    expect(platformApiServerLabel(baseUrl)).toBe(label);
  });
});
