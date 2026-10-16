import { describe, expect, it } from "vitest";

import { AppManifestSchema } from "../manifest";
import { localLaunchConfig } from "./connection-config";

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
    const config = localLaunchConfig(
      launch,
      localManifest({
        env: { NODE_OPTIONS: "--require ./preload.js", PATH: "/tmp/bin" },
      }),
      "secret-token",
    );

    expect(config.env).toMatchObject({
      API_TOKEN: "secret-token",
      HOME: "/Users/sam",
      PATH: "/usr/bin",
    });
    expect(config.env).not.toHaveProperty("NODE_OPTIONS");
  });
});
