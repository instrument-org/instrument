import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ base: "https://api.tryinstrument.com" }));
const machine = vi.hoisted(() => ({
  revoked: [] as string[],
  token: undefined as string | undefined,
  tokens: {} as Record<string, Record<string, string>>,
  workspaces: [] as { id: string; path: string }[],
}));

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
  readBearerTokensIn: (keysDir: string) => machine.tokens[keysDir] ?? {},
  setSessionToken: vi.fn(),
}));
vi.mock("@/electron-main/platform-api/utils", () => ({
  getToken: () => machine.token,
}));
vi.mock("@/electron-main/lib/get-workspace-folder", () => ({
  getUserDataDir: () => "/data",
}));
vi.mock("@/electron-main/lib/workspace-management", () => ({
  keysDirOf: (_userDataDir: string, workspace: { id: string }) =>
    `/keys/${workspace.id}`,
  listWorkspaces: () =>
    machine.workspaces.map((workspace) => ({
      ...workspace,
      isResolved: workspace.id === "here",
    })),
}));
vi.mock("@/electron-main/lib/workspace-run", () => ({
  getResolvedWorkspace: () => ({ id: "here" }),
}));
vi.mock("better-auth/client", () => ({
  createAuthClient: () => ({
    signOut: ({
      fetchOptions,
    }: {
      fetchOptions: { headers: { authorization: string } };
    }) => {
      machine.revoked.push(fetchOptions.headers.authorization);
      return Promise.resolve({ error: null });
    },
  }),
}));
vi.mock("@instrument-org/workspace/electron", () => ({
  accountSignedIn: vi.fn(),
}));
vi.mock("../lib/capture-server-exception", () => ({
  captureServerException: vi.fn(),
}));

import { continueOnWebsite, signOut } from "./client";

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

describe("signOut", () => {
  it.each([
    ["ends a session no other workspace holds", "other-token", ["Bearer mine"]],
    ["keeps a session another workspace shares", "mine", []],
  ])("%s", async (_name, othersToken, revoked) => {
    api.base = "https://api.tryinstrument.com";
    machine.revoked = [];
    machine.token = "mine";
    machine.workspaces = [
      { id: "here", path: "/here" },
      { id: "copy", path: "/copy" },
    ];
    machine.tokens = {
      "/keys/copy": { "https://api.tryinstrument.com": othersToken },
      "/keys/here": { "https://api.tryinstrument.com": "mine" },
    };
    await signOut();
    expect(machine.revoked).toEqual(revoked);
  });
});
