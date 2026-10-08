import { describe, expect, it } from "vitest";

import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../lib/workspace-config";
import { getUserText } from "./shared";

describe("getUserText", () => {
  it("names the signed-in user, by email alone when the account has no name, and nobody while signed out or where there is no account to read", async () => {
    const config = getWorkspaceConfig();
    setWorkspaceConfig({
      ...config,
      getUser: () =>
        Promise.resolve({ email: "ada@example.com", name: "Ada Lovelace" }),
    });
    await expect(getUserText()).resolves.toBe(
      "The user's name is Ada Lovelace, signed in as ada@example.com.",
    );
    setWorkspaceConfig({
      ...config,
      getUser: () => Promise.resolve({ email: "ada@example.com" }),
    });
    await expect(getUserText()).resolves.toBe(
      "The user is signed in as ada@example.com.",
    );
    setWorkspaceConfig({
      ...config,
      getUser: () => Promise.resolve(undefined),
    });
    await expect(getUserText()).resolves.toBeUndefined();
    const { getUser: _absent, ...noAccount } = config;
    setWorkspaceConfig(noAccount);
    await expect(getUserText()).resolves.toBeUndefined();
  });
});
