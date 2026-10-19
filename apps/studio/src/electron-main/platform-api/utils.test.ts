import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => {
  const tokens: Record<string, string> = {};
  return { tokens };
});

vi.mock("@/electron-main/stores/workspace/session", () => ({
  forgetSessionToken: (origin: string) => {
    delete session.tokens[origin];
  },
  getSessionToken: (origin: string) => session.tokens[origin],
}));

vi.stubEnv("MAIN_VITE_APP_API_BASE_URL", "https://api.example/");

const { forgetRefusedToken, getToken, hasToken } = await import("./utils");

beforeEach(() => {
  session.tokens = {
    "https://api.example": "current",
    "https://staging.example": "staging",
  };
});

describe("getToken", () => {
  it("reads the sign-in to the server this process talks to", () => {
    expect(getToken()).toBe("current");
  });
});

describe("forgetRefusedToken", () => {
  it("signs out of this server when it refuses the token, keeping the others", () => {
    expect(forgetRefusedToken("Bearer current")).toBe(true);
    expect(hasToken()).toBe(false);
    expect(session.tokens).toEqual({ "https://staging.example": "staging" });
  });

  it.each([
    ["a token a newer sign-in replaced", "Bearer earlier"],
    ["another server's token", "Bearer staging"],
    ["a request that carried no token", null],
  ])("keeps the token after a refusal of %s", (_name, sent) => {
    expect(forgetRefusedToken(sent)).toBe(false);
    expect(hasToken()).toBe(true);
  });
});
