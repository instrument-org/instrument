import { AIProviderConfigIdSchema } from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { forgetApps, seedApp } from "../../test/helpers/seed-app";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { buildAppsContextText } from "./context";
import { createMemoryAppsConfig } from "./memory-config";
import { loadApp, publishSignIn } from "./store";
import { writeDeviceFile } from "../records/device-file";
import { DeviceIdSchema } from "../records/device-id";
import { workspaceLayout } from "../workspace-layout";

const OTHER_COMPUTER = DeviceIdSchema.parse("dev_7Q2M4K9X");

const previous = getWorkspaceConfig();

beforeEach(() => {
  setWorkspaceConfig({ ...previous, apps: createMemoryAppsConfig() });
});

afterEach(async () => {
  setWorkspaceConfig(previous);
  await forgetApps();
});

/** An app in the store, with the instructions as its guide. */
async function writeApp(name: string, id: string, instructions: string) {
  await seedApp(id, {
    guide: instructions,
    name,
    setup: {
      auth: { kind: "none" },
      type: "mcp",
      url: "https://mcp.example.com",
    },
  });
}

/** Records the app as connected on the manifest its file holds. */
async function connect(id: string) {
  const app = (await loadApp(id))._unsafeUnwrap();
  await getWorkspaceConfig().apps.connections.set(id, {
    manifestHash: app.manifestHash,
    status: "connected",
    updatedAt: Date.now(),
  });
}

describe("the apps a session starts with", () => {
  it("gives a connected app's instructions, as its guide", async () => {
    await writeApp("Linear", "linear", "Issues are `/issues`.\n\nTeams first.");
    await connect("linear");

    expect(await buildAppsContextText()).toContain(
      [
        'The instructions for "Linear" (linear), its guide:',
        "<app_instructions>",
        "Issues are `/issues`.",
        "",
        "Teams first.",
        "</app_instructions>",
      ].join("\n"),
    );
  });

  it("gives an app that is not connected its row and none of its instructions", async () => {
    await writeApp("Linear", "linear", "Issues are `/issues`.");

    const text = await buildAppsContextText();
    expect(text).toContain("- linear (Linear, mcp): not connected");
    expect(text).not.toContain("app_instructions");
  });

  it("says where X's search and its site each stand", async () => {
    await seedApp("x", {
      name: "X",
      setup: { type: "web", url: "https://x.com" },
    });
    const row = async () =>
      (await buildAppsContextText())
        .split("\n")
        .find((line) => line.startsWith("- x "));

    expect(await row()).toMatchInlineSnapshot(
      `"- x (X, web at https://x.com, with Instrument's X tools: \`instrument app tools x\`): search through the Grok plan (not signed in on this computer) · x.com not checked on this computer yet: the user may already be signed in on the site in Instrument's browser"`,
    );

    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      getAIProviderConfigs: () => [
        {
          apiKey: "grok-token",
          cacheIdentifier: "grok-account",
          id: AIProviderConfigIdSchema.parse("grok-account-1"),
          type: "grok-account",
        },
      ],
    });
    expect(await row()).toContain(
      "search through the Grok plan (signed in) · x.com not checked on this computer yet",
    );
  });

  it("has a web app not checked here said to be maybe signed in already", async () => {
    await seedApp("shopify", {
      guide: "",
      name: "Shopify",
      setup: { type: "web", url: "https://admin.shopify.com" },
    });
    await getWorkspaceConfig().apps.connections.set("shopify", {
      status: "needs-sign-in",
      updatedAt: Date.now(),
    });

    expect(await buildAppsContextText()).toContain(
      "- shopify (Shopify, web at https://admin.shopify.com): not checked on this computer yet: the user may already be signed in on the site in Instrument's browser",
    );
  });

  it("says where an app not connected here is connected on another computer", async () => {
    await seedApp("craft", {
      guide: "",
      name: "Craft",
      setup: {
        auth: { kind: "oauth" },
        type: "mcp",
        url: "https://mcp.craft.do/mcp",
      },
    });
    const app = (await loadApp("craft"))._unsafeUnwrap();
    await publishSignIn(OTHER_COMPUTER, "craft", {
      account: "sam@example.com",
      manifestHash: app.manifestHash,
      status: "connected",
      updatedAt: 1,
    });

    expect(await buildAppsContextText()).toContain(
      "- craft (Craft, mcp): not connected; connected on another computer as sam@example.com",
    );
  });

  it("sets aside a computer that has not run the app for a month", async () => {
    await seedApp("craft", {
      guide: "",
      name: "Craft",
      setup: {
        auth: { kind: "oauth" },
        type: "mcp",
        url: "https://mcp.craft.do/mcp",
      },
    });
    const app = (await loadApp("craft"))._unsafeUnwrap();
    await publishSignIn(OTHER_COMPUTER, "craft", {
      manifestHash: app.manifestHash,
      status: "connected",
      updatedAt: 1,
    });
    const devicesDir = workspaceLayout(getWorkspaceConfig().rootDir).devicesDir;
    await writeDeviceFile({
      device: OTHER_COMPUTER,
      devicesDir,
      file: { name: "Old MacBook", platform: "darwin" },
      now: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    });

    try {
      expect(await buildAppsContextText()).not.toContain("connected on");
    } finally {
      await fs.rm(path.join(devicesDir, OTHER_COMPUTER), {
        force: true,
        recursive: true,
      });
    }
  });

  it("says nothing of another computer for an app connected here", async () => {
    await writeApp("Linear", "linear", "");
    await connect("linear");
    const app = (await loadApp("linear"))._unsafeUnwrap();
    await publishSignIn(OTHER_COMPUTER, "linear", {
      manifestHash: app.manifestHash,
      status: "connected",
      updatedAt: 1,
    });

    expect(await buildAppsContextText()).not.toContain("another computer");
  });

  it.each([
    ["external", "connected, signed in from the user's own browser, 202 tools"],
    ["app", "connected, signed in from Instrument's browser, 202 tools"],
    [undefined, "connected, 202 tools"],
  ] as const)(
    "states where a connected app signed in: %s",
    async (signedInFrom, standing) => {
      await seedApp("tella", {
        guide: "",
        name: "Tella",
        setup: {
          auth: { kind: "oauth" },
          type: "mcp",
          url: "https://api.tella.com/mcp",
        },
      });
      const app = (await loadApp("tella"))._unsafeUnwrap();
      await getWorkspaceConfig().apps.connections.set("tella", {
        manifestHash: app.manifestHash,
        ...(signedInFrom && { signedInFrom }),
        status: "connected",
        toolCount: 202,
        updatedAt: 0,
      });

      expect((await buildAppsContextText()).split("\n")).toContain(
        `- tella (Tella, mcp): ${standing}`,
      );
    },
  );

  it.each([
    undefined,
    "declined",
    "failed",
    "needs-approval",
    "needs-key",
    "needs-sign-in",
    "connected",
  ] as const)("gives no step to run for an app that is %s", async (status) => {
    await writeApp("Linear", "linear", "");
    if (status) {
      // Connected on another manifest than the app has, so it wants testing.
      await getWorkspaceConfig().apps.connections.set("linear", {
        manifestHash: "another",
        status,
        updatedAt: 0,
      });
    }

    const row = (await buildAppsContextText())
      .split("\n")
      .find((line) => line.startsWith("- linear"));
    expect(row).toBeDefined();
    expect(row).not.toMatch(/connect_app|instrument app|run `/);
  });

  it("states nowhere for an app whose sign-in is gone", async () => {
    await seedApp("tella", {
      guide: "",
      name: "Tella",
      setup: {
        auth: { kind: "oauth" },
        type: "mcp",
        url: "https://api.tella.com/mcp",
      },
    });
    await getWorkspaceConfig().apps.connections.set("tella", {
      signedInFrom: "external",
      status: "needs-sign-in",
      updatedAt: 0,
    });

    expect(await buildAppsContextText()).not.toContain("signed in from");
  });

  it("says nothing for a connected app whose file holds a manifest and no words", async () => {
    await writeApp("Linear", "linear", "");
    await connect("linear");

    expect(await buildAppsContextText()).not.toContain("app_instructions");
  });

  it("cuts long instructions on a paragraph break, naming the command that reads the rest", async () => {
    await writeApp(
      "Linear",
      "linear",
      `${"a".repeat(19_990)}\n\n${"ZZZ ".repeat(30)}`,
    );
    await connect("linear");

    const text = await buildAppsContextText();
    expect(text).not.toContain("ZZZ");
    expect(text).toContain(
      "[Cut off here: the rest is in `instrument app guide linear`.]",
    );
  });
});
