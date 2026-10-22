import { afterEach, describe, expect, it } from "vitest";

import { getWorkspaceConfig, setWorkspaceConfig } from "../../workspace-config";
import { type McpAppManifest } from "../manifest";
import { createMemoryAppsConfig } from "../memory-config";
import { type McpOAuthStore } from "./oauth-provider";
import { mcpAuthProviderForCommand } from "./tool-auth";

const originalApps = getWorkspaceConfig().apps;

afterEach(() => {
  setWorkspaceConfig({ ...getWorkspaceConfig(), apps: originalApps });
});

/** A store with one sign-in open: its state and verifier in the app's slot. */
function storeWithSignInOpen(): McpOAuthStore {
  const transient = new Map<string, { state?: string; verifier?: string }>();
  transient.set("linear", { state: "open-state", verifier: "open-verifier" });
  const nothing = () => Promise.resolve(undefined);
  const done = () => Promise.resolve();
  return {
    clearClientInformation: done,
    clearTokens: done,
    clearTransient: (slug) => {
      transient.delete(slug);
      return done();
    },
    getClientInformation: nothing,
    getCodeVerifier: (slug) => Promise.resolve(transient.get(slug)?.verifier),
    getState: (slug) => Promise.resolve(transient.get(slug)?.state),
    getTokens: nothing,
    saveClientInformation: done,
    saveCodeVerifier: (slug, verifier) => {
      transient.set(slug, { ...transient.get(slug), verifier });
      return done();
    },
    saveState: (slug, state) => {
      transient.set(slug, { ...transient.get(slug), state });
      return done();
    },
    saveTokens: done,
  };
}

describe("mcpAuthProviderForCommand", () => {
  it("keeps its own PKCE material out of a sign-in the user has open", async () => {
    const store = storeWithSignInOpen();
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      apps: {
        ...createMemoryAppsConfig(),
        oauth: {
          redirectUrl: () => "http://127.0.0.1:1/auth/callback/app",
          relayRedirectUrl: (service) =>
            `https://api.example/oauth/${service}/callback`,
          relayTokenUrl: (service) =>
            `https://api.example/oauth/${service}/token`,
          store,
        },
      },
    });
    const manifest = {
      auth: { kind: "oauth" },
      type: "mcp",
      url: "https://mcp.linear.app/mcp",
    } satisfies McpAppManifest;
    const provider = mcpAuthProviderForCommand("linear", manifest);

    // What the SDK does on its way to an authorization a command cannot open.
    await provider?.state?.();
    await provider?.saveCodeVerifier("command-verifier");
    await provider?.invalidateCredentials?.("verifier");

    expect(await store.getState("linear")).toBe("open-state");
    expect(await store.getCodeVerifier("linear")).toBe("open-verifier");
  });

  it("names the web for when signing in again will not take", () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      apps: {
        ...createMemoryAppsConfig(),
        oauth: {
          redirectUrl: () => "http://127.0.0.1:1/auth/callback/app",
          relayRedirectUrl: (service) =>
            `https://api.example/oauth/${service}/callback`,
          relayTokenUrl: (service) =>
            `https://api.example/oauth/${service}/token`,
          store: storeWithSignInOpen(),
        },
      },
    });
    const provider = mcpAuthProviderForCommand("linear", {
      auth: { kind: "oauth" },
      type: "mcp",
      url: "https://mcp.linear.app/mcp",
    });

    expect(() =>
      provider?.redirectToAuthorization(new URL("https://linear.app/oauth")),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: This app needs the user to sign in again. Ask with connect_app; if that sign-in fails or is refused, sign in on the web instead: \`instrument app new linear --web https://linear.app --force\`, then connect_app.]`,
    );
  });
});
