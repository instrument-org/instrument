import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  values: new Map<string, string>(),
}));

vi.mock("@/electron-main/stores/workspace/session", () => ({
  getSessionStore: () => ({
    delete: (key: string) => session.values.delete(key),
    get: (key: string) => session.values.get(key),
  }),
}));

const { forgetRefusedToken, hasToken } = await import("./utils");

beforeEach(() => {
  session.values.clear();
  session.values.set("apiBearerToken", "current");
});

describe("forgetRefusedToken", () => {
  it("signs out when the platform refuses the token this workspace holds", () => {
    expect(forgetRefusedToken("Bearer current")).toBe(true);
    expect(hasToken()).toBe(false);
  });

  it.each([
    ["a token a newer sign-in replaced", "Bearer earlier"],
    ["a request that carried no token", null],
  ])("keeps the token after a refusal of %s", (_name, sent) => {
    expect(forgetRefusedToken(sent)).toBe(false);
    expect(hasToken()).toBe(true);
  });
});
