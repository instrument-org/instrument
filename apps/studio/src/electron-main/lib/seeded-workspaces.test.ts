import {
  listFixtureNames,
  loadWorkspaceFixture,
  readWorkspace,
  seedWorkspace,
} from "@instrument-org/workspace/fixture-workspaces";
import { newDeviceId } from "@instrument-org/workspace/electron";
import { spawnSync } from "node:child_process";
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
async function seedAndLaunch(
  name: string,
  {
    beforeLaunch,
    under = name,
  }: {
    /** Changes the seeded workspace before the launch's steps run on it. */
    beforeLaunch?: (workspaceDir: string) => void;
    /** The folder this run is seeded in, where one fixture is seeded twice. */
    under?: string;
  } = {},
) {
  const root = path.join(base, under);
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
  beforeLaunch?.(opened.path);
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

/**
 * A 1.x workspace as a real one may be found, put through the same launch:
 * beside the task that is whole, one whose database a crashed build left
 * mid-write, one a step of the sweep cannot put in shape, and memories an
 * earlier build hid while one was saved at the top level since. Each is
 * something that once kept a task or a file out of what the person sees,
 * for good, with only a line in the log.
 */
describe("a 1.x workspace left in bad shape, after a launch", () => {
  function copyTask(tasks: string, to: string, name: string) {
    fs.cpSync(path.join(tasks, "squares-pdf"), path.join(tasks, to), {
      recursive: true,
    });
    const settings = path.join(tasks, to, ".instrument", "settings.json");
    fs.writeFileSync(
      settings,
      JSON.stringify({
        ...(JSON.parse(fs.readFileSync(settings, "utf8")) as object),
        name,
      }),
    );
  }

  it("makes a chat of every task and brings out every memory", async () => {
    failures.length = 0;
    const { chats, opened } = await seedAndLaunch("legacy-tasks", {
      beforeLaunch: (workspaceDir) => {
        const tasks = path.join(workspaceDir, "tasks");

        copyTask(tasks, "crashed", "Crashed mid-write");
        const database = path.join(tasks, "crashed", ".instrument", "task.db");
        const crashed = spawnSync(process.execPath, [
          "-e",
          `const { DatabaseSync } = require("node:sqlite");
           const db = new DatabaseSync(${JSON.stringify(database)});
           db.exec("PRAGMA cache_size = 1; BEGIN");
           const insert = db.prepare("insert into sessions (key, blob) values (?, ?)");
           for (let row = 0; row < 2000; row++) {
             insert.run("scratch:" + row, Buffer.alloc(2048));
           }
           process.kill(process.pid, "SIGKILL");`,
        ]);
        expect(crashed.signal).toBe("SIGKILL");
        expect(fs.existsSync(`${database}-journal`)).toBe(true);

        copyTask(tasks, "held", "Held open");
        // A file where the folder of sent files would be cannot be listed.
        fs.writeFileSync(path.join(tasks, "held", "user-provided"), "a file");

        const hidden = path.join(workspaceDir, ".instrument", "memory");
        fs.mkdirSync(hidden, { recursive: true });
        fs.writeFileSync(path.join(hidden, "older.md"), "Saved by 1.x.");
        fs.mkdirSync(path.join(workspaceDir, "Memory"), { recursive: true });
        fs.writeFileSync(
          path.join(workspaceDir, "Memory", "newer.md"),
          "Saved since.",
        );
      },
      under: "legacy-tasks-in-bad-shape",
    });

    expect(chats.map((chat) => chat.title).toSorted()).toEqual([
      "Crashed mid-write",
      "Held open",
      "Red and blue squares PDF",
    ]);
    expect(fs.readdirSync(path.join(opened.path, "Memory")).toSorted()).toEqual(
      ["newer.md", "older.md"],
    );
    expect(fs.existsSync(path.join(opened.path, "tasks"))).toBe(false);
    expect(failures).toEqual([]);
  });
});
