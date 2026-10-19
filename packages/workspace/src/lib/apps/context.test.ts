import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { APP_FILE_NAME, renderAppFile } from "./app-file";
import { buildAppsContextText } from "./context";
import { AppManifestSchema, AppSlugSchema } from "./manifest";
import { createMemoryAppsConfig } from "./memory-config";
import { loadApp } from "./store";

const previous = getWorkspaceConfig();
let appsDir: string;

beforeEach(async () => {
  appsDir = await fs.mkdtemp(path.join(os.tmpdir(), "apps-context-"));
  setWorkspaceConfig({
    ...previous,
    apps: createMemoryAppsConfig(),
    appsDir: AbsolutePathSchema.parse(appsDir),
  });
});

afterEach(async () => {
  setWorkspaceConfig(previous);
  await fs.rm(appsDir, { force: true, recursive: true });
});

/** An app's folder, with the instructions under its manifest. */
async function writeApp(name: string, id: string, instructions: string) {
  await fs.mkdir(path.join(appsDir, name), { recursive: true });
  await fs.writeFile(
    path.join(appsDir, name, APP_FILE_NAME),
    renderAppFile({
      guide: instructions,
      id: AppSlugSchema.parse(id),
      manifest: AppManifestSchema.parse({
        auth: { kind: "none" },
        type: "mcp",
        url: "https://mcp.example.com",
      }),
    }),
  );
}

/** Records the app as connected on the manifest its file holds. */
async function connect(id: string) {
  const app = (
    await loadApp(AbsolutePathSchema.parse(appsDir), id)
  )._unsafeUnwrap();
  await getWorkspaceConfig().apps.connections.set(id, {
    manifestHash: app.manifestHash,
    status: "connected",
    updatedAt: Date.now(),
  });
}

describe("the apps a session starts with", () => {
  it("gives a connected app's instructions, naming the file they are in", async () => {
    await writeApp("Linear", "linear", "Issues are `/issues`.\n\nTeams first.");
    await connect("linear");

    expect(await buildAppsContextText()).toContain(
      [
        'The instructions for "Linear" (linear), in Apps/Linear/APP.md:',
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

  it("says nothing for a connected app whose file holds a manifest and no words", async () => {
    await writeApp("Linear", "linear", "");
    await connect("linear");

    expect(await buildAppsContextText()).not.toContain("app_instructions");
  });

  it("cuts long instructions on a paragraph break, naming the app's own file", async () => {
    await writeApp(
      "Linear",
      "linear",
      `${"a".repeat(19_990)}\n\n${"ZZZ ".repeat(30)}`,
    );
    await connect("linear");

    const text = await buildAppsContextText();
    expect(text).not.toContain("ZZZ");
    expect(text).toContain(
      "[Cut off here: the rest is in Apps/Linear/APP.md.]",
    );
  });
});
