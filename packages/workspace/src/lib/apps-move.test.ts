import { PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { AbsolutePathSchema } from "../schemas/paths";
import { convertAppsToAppFiles, moveAppsToFolder } from "./apps-move";
import { APP_FILE_NAME, APPS_FOLDER_NAME } from "./apps/app-file";
import { isConnected } from "./apps/connection";
import { manifestHash } from "./apps/manifest";
import { createMemoryAppsConfig } from "./apps/memory-config";
import { loadApp } from "./apps/store";

/** The manifest an earlier build wrote: a name of its own, and `baseUrl`. */
const notion = {
  auth: { kind: "bearer" },
  baseUrl: "https://api.notion.com/v1",
  headers: { "Notion-Version": "2022-06-28" },
  name: "Notion",
  service: "notion",
  test: { path: "/users/me" },
  type: "api",
};

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "apps-move-"));
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

/** An app folder as an earlier build left it, hidden or out at the top. */
async function writeOldApp(
  where: string,
  slug: string,
  manifest: object,
  files: Record<string, string> = {},
) {
  const dir = path.join(where, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "app.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  for (const [name, body] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), body);
  }
}

function hiddenApps() {
  return path.join(root, PRIVATE_FOLDER_NAME, "apps");
}

function apps() {
  return AbsolutePathSchema.parse(path.join(root, APPS_FOLDER_NAME));
}

const connections = () => createMemoryAppsConfig().connections;

it("brings the hidden apps folder out to the top level", async () => {
  await writeOldApp(hiddenApps(), "notion", notion);

  expect(await moveAppsToFolder(root)).toMatchObject({ kind: "moved" });
  expect(await fs.readdir(apps())).toEqual(["notion"]);
  expect(await moveAppsToFolder(root)).toEqual({ kind: "none" });
});

it("leaves an Apps folder the person already made, and the hidden one with it", async () => {
  await writeOldApp(hiddenApps(), "notion", notion);
  await fs.mkdir(path.join(apps(), "Theirs"), { recursive: true });

  expect(await moveAppsToFolder(root)).toMatchObject({ kind: "already-there" });
  expect(await fs.readdir(hiddenApps())).toEqual(["notion"]);
});

it("turns an app's two files into one APP.md in a folder named for it", async () => {
  await writeOldApp(apps(), "notion", notion, {
    "guide.md": "# Notion\n\nWhat it is for.\n",
    "icon.svg": "<svg/>",
  });

  const converted = await convertAppsToAppFiles(root, {
    connections: connections(),
  });

  expect(converted).toMatchInlineSnapshot(`
    {
      "done": [
        "converted notion to Notion/APP.md",
      ],
      "left": [],
    }
  `);
  expect(await fs.readdir(apps())).toEqual(["Notion"]);
  expect(await fs.readdir(path.join(apps(), "Notion"))).toEqual([
    APP_FILE_NAME,
    "icon.svg",
  ]);
  expect(await fs.readFile(path.join(apps(), "Notion", APP_FILE_NAME), "utf8"))
    .toMatchInlineSnapshot(`
    "---
    id: notion
    type: api
    url: https://api.notion.com/v1
    auth:
      kind: bearer
    headers:
      Notion-Version: 2022-06-28
    test:
      path: /users/me
    service: notion
    ---

    # Notion

    What it is for.
    "
  `);
});

it("leaves a converted app alone when it runs again", async () => {
  await writeOldApp(apps(), "notion", notion, { "guide.md": "What for.\n" });
  await convertAppsToAppFiles(root, { connections: connections() });
  const file = path.join(apps(), "Notion", APP_FILE_NAME);
  const written = await fs.readFile(file, "utf8");

  const again = await convertAppsToAppFiles(root, {
    connections: connections(),
  });

  expect(again).toEqual({ done: [], left: [] });
  expect(await fs.readFile(file, "utf8")).toBe(written);
});

it("gives the second app of one service a numbered folder", async () => {
  const gmail = { name: "Gmail", type: "web", url: "https://mail.google.com" };
  await writeOldApp(apps(), "gmail", gmail);
  await writeOldApp(apps(), "gmail-2", gmail);

  await convertAppsToAppFiles(root, { connections: connections() });

  expect(await fs.readdir(apps())).toEqual(["Gmail", "Gmail 2"]);
  const second = await loadApp(apps(), "gmail-2");
  expect(second._unsafeUnwrap().name).toBe("Gmail 2");
});

it("leaves a folder of the person's own that was never an app", async () => {
  await fs.mkdir(path.join(apps(), "Notes to self"), { recursive: true });
  await fs.writeFile(path.join(apps(), "Notes to self", "a.md"), "Mine.");

  const converted = await convertAppsToAppFiles(root, {
    connections: connections(),
  });

  expect(converted).toEqual({ done: [], left: [] });
  expect(await fs.readdir(path.join(apps(), "Notes to self"))).toEqual([
    "a.md",
  ]);
});

it("keeps a connected app connected, and leaves a record that was already stale", async () => {
  await writeOldApp(apps(), "notion", notion, { "guide.md": "What for.\n" });
  await writeOldApp(apps(), "linear", {
    auth: { kind: "oauth" },
    name: "Linear",
    type: "mcp",
    url: "https://mcp.linear.app/mcp",
  });
  const store = connections();
  // What the build before this one recorded when each app passed its test.
  const was = manifestHash(notion);
  await store.set("notion", {
    account: "jeremy@pileofturtles.com",
    approvedManifestHash: was,
    connectedAt: 1,
    manifestHash: was,
    status: "connected",
    updatedAt: 2,
  });
  await store.set("linear", {
    manifestHash: "a manifest nobody has",
    status: "connected",
    updatedAt: 3,
  });

  await convertAppsToAppFiles(root, { connections: store });

  const app = (await loadApp(apps(), "notion"))._unsafeUnwrap();
  const record = await store.get("notion");
  expect(app.manifestHash).not.toBe(was);
  expect(isConnected(record, app.manifestHash)).toBe(true);
  expect(record).toMatchObject({
    account: "jeremy@pileofturtles.com",
    approvedManifestHash: app.manifestHash,
    connectedAt: 1,
    updatedAt: 2,
  });
  const linear = (await loadApp(apps(), "linear"))._unsafeUnwrap();
  expect(isConnected(await store.get("linear"), linear.manifestHash)).toBe(
    false,
  );
});
