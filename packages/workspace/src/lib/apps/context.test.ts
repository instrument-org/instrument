import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { forgetApps, seedApp } from "../../test/helpers/seed-app";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { buildAppsContextText } from "./context";
import { createMemoryAppsConfig } from "./memory-config";
import { loadApp } from "./store";

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

  it("has a web app waiting on its sign-in said to be maybe signed in already", async () => {
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
      "- shopify (Shopify, web at https://admin.shopify.com): not marked signed in, though the user may already be signed in on the site in Instrument's browser",
    );
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
