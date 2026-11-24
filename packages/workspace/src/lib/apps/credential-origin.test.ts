import { afterEach, describe, expect, it } from "vitest";

import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { requireAppKeys } from "./credential-origin";
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

describe("requireAppKeys", () => {
  it("sends the key to the origin it was approved for", async () => {
    storing("https://api.example.com");
    await expect(
      requireAppKeys("notes", api("https://api.example.com/v2")),
    ).resolves.toEqual([{ placement: { kind: "bearer" }, value: "k3y" }]);
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
    await expect(requireAppKeys("notes", api(url))).rejects.toThrow(said);
  });

  it("sends the agent to connect_app when no key is stored", async () => {
    storing();
    await expect(
      requireAppKeys("notes", api("https://api.example.com")),
    ).rejects.toThrow(
      '"notes" has no key stored. Ask the user for one with connect_app',
    );
  });

  it("asks for no key where the app's auth takes none", async () => {
    storing();
    await expect(
      requireAppKeys("notes", {
        ...api("https://api.example.com"),
        auth: { kind: "none" },
      }),
    ).resolves.toEqual([]);
  });

  describe("for an app that takes several", () => {
    const several: ApiAppManifest = {
      ...api("https://api.example.com"),
      auth: {
        keys: [
          { header: "X-Api-Key", kind: "header", label: "API key" },
          { header: "X-App-Key", kind: "header", label: "Application key" },
        ],
        kind: "keys",
      },
    };
    const stored = (label: string | undefined, origin: string) => ({
      label,
      origin,
      value: `the ${label}`,
    });
    const use = (...keys: ReturnType<typeof stored>[]) => {
      setWorkspaceConfig({
        ...getWorkspaceConfig(),
        apps: createMemoryAppsConfig({ credentials: { notes: keys } }),
      });
    };

    it("sends each in its own place", async () => {
      use(
        stored("Application key", "https://api.example.com"),
        stored("API key", "https://api.example.com"),
      );
      await expect(requireAppKeys("notes", several)).resolves.toEqual([
        {
          placement: { header: "X-Api-Key", kind: "header" },
          value: "the API key",
        },
        {
          placement: { header: "X-App-Key", kind: "header" },
          value: "the Application key",
        },
      ]);
    });

    it("sends none while one is missing, naming it", async () => {
      use(stored("API key", "https://api.example.com"));
      await expect(requireAppKeys("notes", several)).rejects.toThrow(
        '"notes" has no "Application key" key stored.',
      );
    });

    it("sends none where one was approved for another origin", async () => {
      use(
        stored("API key", "https://api.example.com"),
        stored("Application key", "https://old.example.com"),
      );
      await expect(requireAppKeys("notes", several)).rejects.toThrow(
        "The stored key was approved for https://old.example.com",
      );
    });

    it("never takes an app's one key for a labeled one", async () => {
      use(stored(undefined, "https://api.example.com"));
      await expect(requireAppKeys("notes", several)).rejects.toThrow(
        'has no "API key" or "Application key" key stored',
      );
    });
  });
});
