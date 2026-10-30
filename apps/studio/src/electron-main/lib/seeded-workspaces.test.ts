import {
  listFixtureNames,
  loadWorkspaceFixture,
  readWorkspace,
  seedWorkspace,
} from "@instrument-org/workspace/fixture-workspaces";
import { newDeviceId } from "@instrument-org/workspace/electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { FeatureNameSchema } from "@/shared/features";

import { WorkspacePreferencesSchema } from "../stores/workspace/preferences";
import { workspaceInAppData } from "./get-workspace-folder";
import { resolveLaunchWorkspace, settleMachineFolders } from "./open-workspace";
import { isRefusedFile, userDataViewRule } from "./refused-files";
import { sweepWorkspaceFolder } from "./workspace-launch-sweeps";
import { beginWorkspaceRun } from "./workspace-run";

/**
 * The guard over the committed fixtures (`fixtures/workspaces/`): each is
 * seeded into a fresh userData and home, put through the launch's own steps
 * as a boot of Studio would, and read back only through the app's readers.
 * Everything the manifest names has to come out the other side, visible and
 * viewable; a seeder that writes what the app no longer reads fails here
 * rather than as a fixture that boots empty.
 */

const userData = vi.hoisted(() => ({ dir: "" }));
const failures = vi.hoisted((): unknown[] => []);

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
vi.mock("./capture-server-exception", () => ({
  captureServerException: (error: unknown) => {
    failures.push(error);
  },
}));
vi.mock("@/electron-main/lib/notices", () => ({
  noteChatsLeftBehind: vi.fn(),
}));

const base = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "seeded-workspaces-")),
);
afterAll(() => {
  fs.rmSync(base, { force: true, recursive: true });
});

const log = { info: () => undefined, warn: () => undefined };

/** Seeds a fixture and launches on it, as `studio-drive boot --workspace` does. */
async function seedAndLaunch(name: string) {
  const root = path.join(base, name);
  const userDataDir = path.join(root, "userdata");
  const home = path.join(root, "home");
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  userData.dir = userDataDir;

  const loaded = await loadWorkspaceFixture(name);
  // Pins beyond what the fixture does, so every kind of preference is seen to
  // reach where the app reads it: a flag, and a choice away from its default.
  const fixture = {
    ...loaded,
    settings: {
      ...loaded.settings,
      preferences: {
        ...loaded.settings.preferences,
        blockAds: false,
        features: Object.fromEntries(
          FeatureNameSchema.options.slice(0, 1).map((flag) => [flag, true]),
        ),
      },
    },
  };
  await seedWorkspace({ fixture, home, userDataDir });

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
  await sweepWorkspaceFolder({
    deviceId: newDeviceId(),
    inAppData: workspaceInAppData(),
    rootDir: opened.path,
  });

  const chats = await readWorkspace({
    machineDir: opened.machineDir,
    rootDir: opened.path,
    userDataDir,
    workFoldersDir: opened.workFoldersDir,
  });
  const rule = userDataViewRule({
    home,
    userDataDir,
    workspaceDir: opened.path,
  });
  return { chats, fixture, home, opened, rule };
}

/** A file as the person's viewers see it: there, and not refused. */
async function viewable(
  file: string,
  rule: ReturnType<typeof userDataViewRule>,
) {
  return {
    exists: fs.existsSync(file),
    file,
    refused: await isRefusedFile(file, rule),
  };
}

const names = await listFixtureNames();

describe.each(names)("the %s fixture, after a launch", (name) => {
  it("shows every chat, task and file its manifest names", async () => {
    const { chats, fixture, home, opened, rule } = await seedAndLaunch(name);

    // Its chats work beside its own data, never in the developer's home.
    expect(opened.workFoldersDir.startsWith(`${home}${path.sep}`)).toBe(true);

    for (const { chat, folders, tasks } of fixture.chats) {
      const found = chats.find((each) => each.title === chat.name);
      expect(found, `chat "${chat.name}"`).toBeDefined();
      if (!found) {
        continue;
      }
      for (const { files, task } of tasks) {
        const started = found.tasks.find((each) => each.title === task.name);
        expect(started, `task "${task.name}"`).toBeDefined();
        // A task forked from its chat reads the chat's messages up to then.
        expect(started?.inherited, `"${task.name}" history`).toBeGreaterThan(0);
        for (const file of files) {
          expect(
            await viewable(path.join(found.workDir, file.to), rule),
          ).toEqual({
            exists: true,
            file: path.join(found.workDir, file.to),
            refused: false,
          });
        }
      }
      for (const folder of folders) {
        const granted = found.grants.find(
          (grant) => path.basename(grant) === folder.mount,
        );
        expect(granted, `folder "${folder.mount}"`).toBeDefined();
        for (const file of folder.files) {
          expect(
            await viewable(path.join(granted ?? "", file.to), rule),
          ).toEqual({
            exists: true,
            file: path.join(granted ?? "", file.to),
            refused: false,
          });
        }
      }
    }

    // A 1.x task is a chat once the launch has made it one.
    for (const { files, task } of fixture.tasks) {
      const found = chats.find((each) => each.title === task.name);
      expect(found, `1.x task "${task.name}"`).toBeDefined();
      for (const file of files) {
        expect(
          await viewable(path.join(found?.workDir ?? "", file.to), rule),
        ).toEqual({
          exists: true,
          file: path.join(found?.workDir ?? "", file.to),
          refused: false,
        });
      }
    }

    const preferences = WorkspacePreferencesSchema.parse(
      JSON.parse(
        fs.readFileSync(
          path.join(opened.machineDir, "preferences.json"),
          "utf8",
        ),
      ),
    );
    expect(preferences).toMatchObject(fixture.settings.preferences ?? {});
    expect(failures).toEqual([]);
  });
});
