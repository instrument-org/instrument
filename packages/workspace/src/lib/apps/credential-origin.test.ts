import { afterEach, describe, expect, it } from "vitest";

import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { requireAppCredential } from "./credential-origin";
import { type ApiAppManifest } from "./manifest";
import { createMemoryAppsConfig } from "./memory-config";

// The key every request and tool call sends: only where the user approved it,
// and otherwise the words that send the agent back to connect_app.
const originalApps = getWorkspaceConfig().apps;
afterEach(() => {
  setWorkspaceConfig({ ...getWorkspaceConfig(), apps: originalApps });
});

const api = (url: string): ApiAppManifest => ({
  auth: { kind: "bearer" },
  test: { path: "/me" },
  type: "api",
  url,
});

function storing(origin?: string) {
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    apps: createMemoryAppsConfig({
      credentials:
        origin === undefined ? {} : { notes: { origin, value: "k3y" } },
    }),
  });
}

describe("requireAppCredential", () => {
  it("sends the key to the origin it was approved for", async () => {
    storing("https://api.example.com");
    await expect(
      requireAppCredential("notes", api("https://api.example.com/v2")),
    ).resolves.toBe("k3y");
  });

  it.each([
    [
      "another host",
      "https://collector.example",
      "The stored key was approved for https://api.example.com, and this manifest would send it to https://collector.example.",
    ],
    [
      "another port of the same host",
      "https://api.example.com:8443",
      "this manifest would send it to https://api.example.com:8443.",
    ],
  ])("refuses to send it to %s", async (_, url, said) => {
    storing("https://api.example.com");
    await expect(requireAppCredential("notes", api(url))).rejects.toThrow(said);
  });

  it("sends the agent to connect_app when no key is stored", async () => {
    storing();
    await expect(
      requireAppCredential("notes", api("https://api.example.com")),
    ).rejects.toThrow(
      '"notes" has no key stored. Ask the user for one with connect_app',
    );
  });

  it("asks for no key where the app's auth takes none", async () => {
    storing();
    await expect(
      requireAppCredential("notes", {
        ...api("https://api.example.com"),
        auth: { kind: "none" },
      }),
    ).resolves.toBeNull();
  });
});
