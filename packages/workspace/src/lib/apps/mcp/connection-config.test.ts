import { describe, expect, it } from "vitest";

import { AppManifestSchema } from "../manifest";
import { appKeySlots } from "../keys";
import { localLaunchConfig, mcpConnectionConfig } from "./connection-config";

function localManifest(fields: object) {
  const manifest = AppManifestSchema.parse({
    auth: { envVar: "API_TOKEN", kind: "env" },
    package: "@agiletortoise/drafts-mcp-server",
    runtime: "node",
    type: "mcp-local",
    ...fields,
  });
  if (manifest.type !== "mcp-local") {
    throw new Error("Expected a local app's manifest");
  }
  return manifest;
}

describe("localLaunchConfig", () => {
  const launch = {
    args: ["server.js"],
    command: "/runtime/node",
    env: { HOME: "/Users/sam", PATH: "/usr/bin" },
  };

  // The server runs outside the sandbox, so a variable the manifest's author
  // chose (`NODE_OPTIONS=--require <file>`) would load code from wherever
  // they pointed it.
  it("launches with the app's environment and the credential, whatever the manifest says", () => {
    const manifest = localManifest({
      env: { NODE_OPTIONS: "--require ./preload.js", PATH: "/tmp/bin" },
    });
    const config = localLaunchConfig(
      launch,
      appKeySlots(manifest).map(({ placement }) => ({
        placement,
        value: "secret-token",
      })),
    );

    expect(config.env).toMatchObject({
      API_TOKEN: "secret-token",
      HOME: "/Users/sam",
      PATH: "/usr/bin",
    });
    expect(config.env).not.toHaveProperty("NODE_OPTIONS");
  });

  it("hands a server each of its keys under its own variable", () => {
    const manifest = localManifest({
      auth: {
        keys: [
          { envVar: "TRELLO_KEY", kind: "env", label: "API key" },
          { envVar: "TRELLO_TOKEN", kind: "env", label: "Token" },
        ],
        kind: "keys",
      },
    });
    const config = localLaunchConfig(
      launch,
      appKeySlots(manifest).map(({ label, placement }) => ({
        placement,
        value: `the ${label}`,
      })),
    );

    expect(config.env).toMatchObject({
      TRELLO_KEY: "the API key",
      TRELLO_TOKEN: "the Token",
    });
  });
});

describe("mcpConnectionConfig", () => {
  it("sends a server every key in its own header", () => {
    expect(
      mcpConnectionConfig(
        {
          auth: { kind: "none" },
          type: "mcp",
          url: "https://mcp.example.com",
        },
        [
          { placement: { kind: "bearer" }, value: "one" },
          { placement: { header: "X-Second", kind: "header" }, value: "two" },
        ],
      ).headers,
    ).toEqual({ Authorization: "Bearer one", "X-Second": "two" });
  });
});
