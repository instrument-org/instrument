import {
  loadWorkspaceFixture,
  seedWorkspace,
} from "@instrument-org/workspace/fixture-workspaces";
import { newDeviceId } from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { workspaceInAppData } from "./get-workspace-folder";
import { resolveLaunchWorkspace, settleMachineFolders } from "./open-workspace";
import { upgradeWorkspace } from "./upgrade-workspace";
import { beginWorkspaceRun } from "./workspace-run";
import { readWorkspaceIdentity, writeWorkspaceIdentity } from "./workspaces";

/**
 * The launch's steps over every chat, once a launch before has finished them
 * for the whole workspace: later launches read no chat's folder for them.
 */

const userData = vi.hoisted(() => ({ dir: "" }));

vi.mock("electron", () => ({
  app: {
    getPath: () => userData.dir,
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}));
vi.mock("./electron-logger", () => {
  const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  return { logger: { ...log, scope: () => log } };
});
vi.mock("@/electron-main/lib/notices", () => ({
  noteChatsLeftBehind: vi.fn(),
}));

const base = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "upgrade-workspace-")),
);
afterAll(() => {
  fs.rmSync(base, { force: true, recursive: true });
});

const DEVICE = newDeviceId();
let rootDir = "";
let chatDir = "";

beforeAll(async () => {
  const userDataDir = path.join(base, "userdata");
  const home = path.join(base, "home");
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  userData.dir = userDataDir;
  vi.stubEnv("INSTRUMENT_OUTPUT_FOLDER", path.join(base, "output"));
  const log = { info: () => undefined, warn: () => undefined };
  await seedWorkspace({
    fixture: await loadWorkspaceFixture("documents"),
    home,
    userDataDir,
  });
  const launch = resolveLaunchWorkspace({
    log,
    packaged: false,
    pin: undefined,
    userDataDir,
  });
  if (launch.kind !== "open") {
    throw new Error(`The seeded workspace did not open: ${launch.kind}`);
  }
  const opened = settleMachineFolders({
    home,
    log,
    userDataDir,
    workspace: launch.workspace,
  });
  beginWorkspaceRun({ kind: "placed", workspace: opened });
  rootDir = opened.path;
  chatDir = path.join(
    workspaceLayout(rootDir).chatsDir,
    "red-and-blue-squares",
  );
});

const upgrade = () =>
  upgradeWorkspace({
    deviceId: DEVICE,
    inAppData: workspaceInAppData(),
    rootDir,
  });

it("marks the workspace once every chat is on its records and has no settings.json", async () => {
  await upgrade();

  expect(readWorkspaceIdentity(rootDir)).toMatchObject({
    chatRecordsConverted: true,
    chatSettingsConverted: true,
  });
});

it("reads no chat's folder for them on a launch after", async () => {
  const settings = path.join(chatDir, "settings.json");
  fs.writeFileSync(settings, JSON.stringify({ modelURI: "openai/gpt" }));

  await upgrade();

  expect(fs.existsSync(settings)).toBe(true);

  // Without the mark, the launch carries the file and marks the workspace
  // again.
  const { chatSettingsConverted: _, ...identity } =
    readWorkspaceIdentity(rootDir);
  writeWorkspaceIdentity(rootDir, identity);

  await upgrade();

  expect(fs.existsSync(settings)).toBe(false);
  expect(readWorkspaceIdentity(rootDir).chatSettingsConverted).toBe(true);
});
