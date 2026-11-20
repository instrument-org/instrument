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

  it("has a web app waiting on its sign-in checked in a tab before the user is asked again", async () => {
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
      "- shopify (Shopify, web at https://admin.shopify.com): not marked signed in. Open its site in a tab first: if it loads signed in, ask the user to press Done signing in on a connect_app card (call it if none is open) rather than sign in again; otherwise connect_app",
    );
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
