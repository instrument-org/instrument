import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ base: "https://api.tryinstrument.com" }));

vi.mock("@/electron-main/platform-api/base-url", () => ({
  platformApiBaseUrl: () => api.base,
  platformApiOrigin: () => new URL(api.base).origin,
}));
vi.mock("@/electron-main/platform-api/client", () => ({
  platformApiRpcClient: {},
}));
vi.mock("@/electron-main/lib/open-external", () => ({ openExternal: vi.fn() }));
vi.mock("@/electron-main/lib/set-default-model", () => ({
  setDefaultModel: vi.fn(),
}));
vi.mock("@/electron-main/stores/workspace/session", () => ({
  forgetSessionToken: vi.fn(),
  setSessionToken: vi.fn(),
}));
vi.mock("@instrument-org/workspace/electron", () => ({
  accountSignedIn: vi.fn(),
}));
vi.mock("../lib/capture-server-exception", () => ({
  captureServerException: vi.fn(),
}));

import { continueOnWebsite } from "./client";

describe("continueOnWebsite", () => {
  it.each([
    [
      "https://tryinstrument.com/welcome",
      "https://tryinstrument.com/welcome?port=51234",
    ],
    [
      "https://staging.tryinstrument.com/welcome",
      "https://staging.tryinstrument.com/welcome?port=51234",
    ],
    ["http://tryinstrument.com/welcome", undefined],
    ["https://tryinstrument.com.evil.example/welcome", undefined],
    ["https://evil.example/welcome", undefined],
    ["http://localhost:49110/welcome", undefined],
    ["not a url", undefined],
    [undefined, undefined],
  ])("sends %s on as %s", (next, expected) => {
    expect(continueOnWebsite(next, 51_234)).toBe(expected);
  });

  it("follows a local API to a local website", () => {
    api.base = "http://localhost:49100";
    expect(continueOnWebsite("http://localhost:49110/welcome", 51_234)).toBe(
      "http://localhost:49110/welcome?port=51234",
    );
    expect(
      continueOnWebsite("https://tryinstrument.com/welcome", 51_234),
    ).toBeUndefined();
  });
});
