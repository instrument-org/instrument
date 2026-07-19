import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  INSTRUMENT_PROVIDER_NAME,
  instrumentPluginRegistry,
  writeInstrumentProviderPlugin,
} from "./agent-browser-plugin";

const PROTOCOL = "agent-browser.plugin.v1";

describe("instrument provider plugin", () => {
  let dir: string;
  let pluginPath: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "instrument-plugin-"));
    pluginPath = await writeInstrumentProviderPlugin(dir);
  });

  afterAll(async () => {
    await fs.rm(dir, { force: true, recursive: true });
  });

  async function invoke(request: unknown, cdpUrl?: string) {
    const { stdout } = await execa(
      process.execPath,
      cdpUrl === undefined ? [pluginPath] : [pluginPath, cdpUrl],
      { input: JSON.stringify(request) },
    );
    return JSON.parse(stdout) as Record<string, unknown>;
  }

  it("answers plugin.manifest with the provider capability", async () => {
    const response = await invoke({
      capability: "plugin.manifest",
      protocol: PROTOCOL,
      request: {},
      type: "plugin.manifest",
    });

    expect(response).toEqual({
      manifest: {
        capabilities: ["browser.provider"],
        description: "Instrument-managed task browser",
        name: INSTRUMENT_PROVIDER_NAME,
      },
      protocol: PROTOCOL,
      success: true,
    });
  });

  it("answers browser.launch with the CDP URL from argv", async () => {
    const cdpUrl = "ws://127.0.0.1:4100/cdp/devtools/page/abc";
    const response = await invoke(
      {
        capability: "browser.provider",
        protocol: PROTOCOL,
        request: {},
        type: "browser.launch",
      },
      cdpUrl,
    );

    expect(response).toEqual({
      browser: { cdpUrl, directPage: false },
      protocol: PROTOCOL,
      success: true,
    });
  });

  it("fails browser.launch without a CDP URL argument", async () => {
    const response = await invoke({
      capability: "browser.provider",
      protocol: PROTOCOL,
      request: {},
      type: "browser.launch",
    });

    expect(response).toEqual({
      error: "missing CDP URL argument",
      protocol: PROTOCOL,
      success: false,
    });
  });

  it("acknowledges browser.close as a no-op", async () => {
    const response = await invoke(
      {
        capability: "browser.provider",
        protocol: PROTOCOL,
        request: {},
        type: "browser.close",
      },
      "ws://127.0.0.1:4100/cdp/devtools/page/abc",
    );

    expect(response).toEqual({ protocol: PROTOCOL, success: true });
  });

  it.each([
    {
      name: "unsupported protocol",
      request: { protocol: "other.v9", type: "browser.launch" },
    },
    {
      name: "unsupported request type",
      request: { protocol: PROTOCOL, type: "captcha.solve" },
    },
  ])("rejects $name", async ({ request }) => {
    const response = await invoke(request, "ws://127.0.0.1:4100/x");

    expect(response).toMatchObject({ protocol: PROTOCOL, success: false });
  });

  it("rejects malformed JSON input", async () => {
    const { stdout } = await execa(process.execPath, [pluginPath], {
      input: "not json",
    });

    expect(JSON.parse(stdout)).toEqual({
      error: "invalid JSON request",
      protocol: PROTOCOL,
      success: false,
    });
  });
});

describe("instrumentPluginRegistry", () => {
  it("builds a single-entry browser.provider registry", () => {
    const registry = JSON.parse(
      instrumentPluginRegistry({
        cdpUrl: "ws://127.0.0.1:4100/cdp/devtools/page/abc",
        pluginPath: "/tmp/instrument-provider.mjs",
      }),
    ) as unknown;

    expect(registry).toEqual([
      {
        args: [
          "/tmp/instrument-provider.mjs",
          "ws://127.0.0.1:4100/cdp/devtools/page/abc",
        ],
        capabilities: ["browser.provider"],
        command: process.execPath,
        name: INSTRUMENT_PROVIDER_NAME,
      },
    ]);
  });
});
