import { PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { takeInAppFolders } from "./apps-move";
import { APP_FILE_NAME, APPS_FOLDER_NAME } from "./apps/app-file";
import { isConnected } from "./apps/connection";
import { findAppIcon } from "./apps/icon";
import { AppSlugSchema, manifestHash } from "./apps/manifest";
import { createMemoryAppsConfig } from "./apps/memory-config";
import {
  closeAppStores,
  listApps,
  loadApp,
  readAppGuide,
  readAppSetup,
  writeAppGuide,
} from "./apps/store";
import { type DeviceId, newDeviceId } from "./records/device-id";
import { WorkspaceDirSchema } from "../schemas/paths";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { workspaceLayout } from "./workspace-layout";

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

const previous = getWorkspaceConfig();
let root: string;
let device: DeviceId;
let trashed: string[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "apps-move-"));
  device = newDeviceId();
  trashed = [];
  // The store the launch writes is the one the workspace then reads.
  setWorkspaceConfig({
    ...previous,
    deviceId: device,
    rootDir: WorkspaceDirSchema.parse(root),
  });
});

afterEach(async () => {
  setWorkspaceConfig(previous);
  await closeAppStores();
  await fs.rm(root, { force: true, recursive: true });
});

/** Sends a folder to a stand-in Trash: away from where it was. */
async function trash(dir: string) {
  trashed.push(path.relative(root, dir));
  await fs.rm(dir, { recursive: true });
}

function takeIn(connections = createMemoryAppsConfig().connections) {
  return takeInAppFolders(root, { connections, device, trash });
}

/** An app folder as the betas left it, hidden in `.instrument/apps/`. */
async function writeLegacyApp(
  slug: string,
  manifest: object,
  files: Record<string, string> = {},
) {
  const dir = path.join(root, PRIVATE_FOLDER_NAME, "apps", slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "app.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  for (const [name, body] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), body);
  }
}

/** An app folder as the build before this one left it, in `Apps/`. */
async function writeAppFolder(
  name: string,
  text: string,
  files: Record<string, string> = {},
) {
  const dir = path.join(root, APPS_FOLDER_NAME, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, APP_FILE_NAME), text);
  for (const [file, body] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, file), body);
  }
}

/** The lines this device's file of the apps store has. */
async function storeLines() {
  const file = path.join(
    workspaceLayout(root).devicesDir,
    device,
    "apps.jsonl",
  );
  return (await fs.readFile(file, "utf8")).trim().split("\n").length;
}

const linearFile = [
  "---",
  "id: linear",
  "type: mcp",
  "url: https://mcp.linear.app/mcp",
  "auth:",
  "  kind: oauth",
  "color: teal",
  "---",
  "",
  "Issues by team.",
  "",
].join("\n");

it("takes each APP.md into the store, named for its folder, and sends Apps/ to the Trash", async () => {
  await writeAppFolder("My Linear", linearFile, { "icon.svg": "<svg/>" });

  const taken = await takeIn();

  expect(taken.left).toEqual([]);
  expect(trashed).toEqual([APPS_FOLDER_NAME]);
  const app = (await loadApp("linear"))._unsafeUnwrap();
  expect(app.name).toBe("My Linear");
  expect(await readAppGuide(app.slug)).toBe("Issues by team.\n");
  expect((await findAppIcon(app.slug))?.fileName).toBe("icon.svg");
});

it("keeps front matter this build does not read in the app's setup", async () => {
  await writeAppFolder("Linear", linearFile);

  await takeIn();

  expect(await readAppSetup(AppSlugSchema.parse("linear"))).toEqual({
    auth: { kind: "oauth" },
    color: "teal",
    type: "mcp",
    url: "https://mcp.linear.app/mcp",
  });
});

it("writes nothing when it runs again over a folder still there", async () => {
  await writeAppFolder("Linear", linearFile);
  const keep = async () => {
    // A Trash that could not take the folder leaves it for the next launch.
  };
  await takeInAppFolders(root, {
    connections: createMemoryAppsConfig().connections,
    device,
    trash: keep,
  });
  const lines = await storeLines();

  await takeInAppFolders(root, {
    connections: createMemoryAppsConfig().connections,
    device,
    trash: keep,
  });

  expect(await storeLines()).toBe(lines);
});

it("leaves an app the store changed since its file did as the store has it", async () => {
  await writeAppFolder("Linear", linearFile);
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(
    path.join(root, APPS_FOLDER_NAME, "Linear", APP_FILE_NAME),
    old,
    old,
  );
  await takeIn();
  await writeAppGuide(AppSlugSchema.parse("linear"), "Changed since.");

  // A computer still on the earlier build writes the folder again.
  await writeAppFolder("Linear", linearFile);
  await fs.utimes(
    path.join(root, APPS_FOLDER_NAME, "Linear", APP_FILE_NAME),
    old,
    old,
  );
  await takeIn();

  expect(await readAppGuide(AppSlugSchema.parse("linear"))).toBe(
    "Changed since.\n",
  );
});

it("takes in an app whose setup this build cannot read, for the Apps page to say so", async () => {
  await writeAppFolder("Odd", "---\nid: odd\ntype: telepathy\n---\n");

  await takeIn();

  expect(trashed).toEqual([APPS_FOLDER_NAME]);
  expect((await listApps()).invalid.map((entry) => entry.slug)).toEqual([
    "odd",
  ]);
});

it("leaves Apps/ where it is when one app's file cannot be read", async () => {
  await writeAppFolder("Linear", linearFile);
  await writeAppFolder("Broken", "---\nid: broken\nurl: [unclosed\n---\n");

  const taken = await takeIn();

  expect(taken.left.map((entry) => path.basename(entry.where))).toEqual([
    "Broken",
  ]);
  expect(trashed).toEqual([]);
  expect((await loadApp("linear")).isOk()).toBe(true);
});

it("ignores a folder of the person's own that was never an app", async () => {
  await fs.mkdir(path.join(root, APPS_FOLDER_NAME, "Notes to self"), {
    recursive: true,
  });

  const taken = await takeIn();

  expect(taken.left).toEqual([]);
  expect((await listApps()).apps).toEqual([]);
});

it("takes the betas' app.json and guide.md straight into the store", async () => {
  await writeLegacyApp("notion", notion, {
    "guide.md": "# Notion\n\nWhat it is for.\n",
    "icon.svg": "<svg/>",
  });

  await takeIn();

  expect(trashed).toEqual([path.join(PRIVATE_FOLDER_NAME, "apps")]);
  const app = (await loadApp("notion"))._unsafeUnwrap();
  expect(app.name).toBe("Notion");
  expect(await readAppSetup(app.slug)).toMatchInlineSnapshot(`
    {
      "auth": {
        "kind": "bearer",
      },
      "headers": {
        "Notion-Version": "2022-06-28",
      },
      "service": "notion",
      "test": {
        "path": "/users/me",
      },
      "type": "api",
      "url": "https://api.notion.com/v1",
    }
  `);
  expect(await readAppGuide(app.slug)).toBe("# Notion\n\nWhat it is for.\n");
  expect((await findAppIcon(app.slug))?.fileName).toBe("icon.svg");
});

it("gives the second legacy app of one service a numbered name", async () => {
  const gmail = { name: "Gmail", type: "web", url: "https://mail.google.com" };
  await writeLegacyApp("gmail", gmail);
  await writeLegacyApp("gmail-2", gmail);

  await takeIn();

  expect((await listApps()).apps.map((app) => app.name)).toEqual([
    "Gmail",
    "Gmail 2",
  ]);
});

it("keeps a connected legacy app connected, and leaves a record that was already stale", async () => {
  await writeLegacyApp("notion", notion, { "guide.md": "What for.\n" });
  await writeLegacyApp("linear", {
    auth: { kind: "oauth" },
    name: "Linear",
    type: "mcp",
    url: "https://mcp.linear.app/mcp",
  });
  const store = createMemoryAppsConfig().connections;
  // What the build before this one recorded when each app passed its test.
  const was = manifestHash(notion);
  await store.set("notion", {
    account: "name@example.com",
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

  await takeIn(store);

  const app = (await loadApp("notion"))._unsafeUnwrap();
  const record = await store.get("notion");
  expect(app.manifestHash).not.toBe(was);
  expect(isConnected(record, app.manifestHash)).toBe(true);
  expect(record).toMatchObject({
    account: "name@example.com",
    approvedManifestHash: app.manifestHash,
    connectedAt: 1,
    updatedAt: 2,
  });
  const linear = (await loadApp("linear"))._unsafeUnwrap();
  expect(isConnected(await store.get("linear"), linear.manifestHash)).toBe(
    false,
  );
});
