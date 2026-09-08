import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import { pnpmVersion } from "@/electron-main/lib/pnpm";
import {
  isQuitGuardForcedInDev,
  setQuitGuardForcedInDev,
} from "@/electron-main/lib/quit-guard";
import { devOnly } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { setRecentVersionBump } from "@/electron-main/stores/preferences";
import { openOnboardingWindow } from "@/electron-main/windows/onboarding";
import { PORTS } from "@instrument-org/shared";
import { app, shell } from "electron";
import { spawn } from "node:child_process";
import fsSync from "node:fs";
import path from "node:path";
import { z } from "zod";

import { browserViewManagerDebugRoutes } from "../../browser-view/debug-snapshot";

const systemInfo = devOnly.handler(async ({ context }) => {
  const pnpmVersionValue = await pnpmVersion();
  return [
    {
      title: "Node Version",
      value: process.version,
    },
    {
      title: "PNPM Version",
      value: pnpmVersionValue,
    },
    {
      title: "Workspace Root",
      value: context.workspaceConfig.rootDir,
    },
  ];
});

const throwError = devOnly
  .input(
    z.object({
      type: z.enum(["known", "unknown"]),
    }),
  )
  .handler(({ errors, input }) => {
    const error =
      input.type === "known"
        ? errors.NOT_FOUND({ message: "This is a known error for testing" })
        : new Error("This is an uncaught error for testing");
    throw error;
  });

const events = {
  testNotification: devOnly.handler(async function* ({ signal }) {
    for await (const _payload of publisher.subscribe("test-notification", {
      signal,
    })) {
      yield {
        testNotification: true,
      };
    }
  }),
};

const trigger = {
  testDownloadNotification: devOnly.handler(() => {
    publisher.publish("updates.status", {
      status: { notifyUser: true, type: "checking" },
    });

    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;

      if (progress <= 100) {
        publisher.publish("updates.status", {
          status: {
            notifyUser: true,
            progress: {
              bytesPerSecond: 1024 * 1024,
              delta: 1024 * 1024,
              percent: progress,
              total: 100 * 1024 * 1024,
              transferred: progress * 1024 * 1024,
            },
            type: "downloading",
          },
        });
      } else {
        clearInterval(interval);
        publisher.publish("updates.status", {
          status: {
            notifyUser: true,
            type: "downloaded",
            updateInfo: {
              files: [],
              path: "",
              releaseDate: new Date().toISOString(),
              releaseName: "Test Update",
              releaseNotes: "This is a test update",
              sha512: "",
              version: "1.0.0-test",
            },
          },
        });
      }
    }, 500);
  }),
  testErrorNotification: devOnly.handler(() => {
    publisher.publish("updates.status", {
      status: { notifyUser: true, type: "checking" },
    });

    void new Promise((resolve) => setTimeout(resolve, 1000)).then(() => {
      publisher.publish("updates.status", {
        status: {
          message: "There was an error checking for updates",
          notifyUser: true,
          type: "error",
        },
      });
    });
  }),
  testNotification: devOnly.handler(() => {
    publisher.publish("test-notification", null);
  }),
  testNoUpdateNotification: devOnly.handler(() => {
    publisher.publish("updates.status", {
      status: { notifyUser: true, type: "checking" },
    });

    void new Promise((resolve) => setTimeout(resolve, 1000)).then(() => {
      publisher.publish("updates.status", {
        status: {
          notifyUser: true,
          type: "not-available",
          updateInfo: null,
        },
      });
    });
  }),
  testSilentNoUpdate: devOnly.handler(() => {
    publisher.publish("updates.status", {
      status: {
        notifyUser: false,
        type: "not-available",
        updateInfo: null,
      },
    });
  }),
  // Queues the bump only. The toast fires once per renderer lifetime, off a
  // query that runs on mount, so the caller reloads afterwards to see it --
  // which is also the path a real update takes.
  testUpdatedToast: devOnly.handler(() => {
    setRecentVersionBump({ from: "0.0.0-simulated", to: app.getVersion() });
  }),
};

const openOnboarding = devOnly.input(z.void()).handler(() => {
  openOnboardingWindow();
});

const openAuthTestPage = devOnly.input(z.void()).handler(() => {
  const port = app.isPackaged
    ? PORTS.authCallback.prod
    : PORTS.authCallback.dev;
  void shell.openExternal(`http://localhost:${port}/test`);
});

/**
 * The remote debugging port this instance answers on. It is the only thing that
 * separates two instances of one checkout, which is what a hand-started window
 * and an agent-driven one are: the conventional port belongs to the window a
 * person started, and a driven instance derives its own from the checkout path.
 */
function debugPort() {
  const port = Number(app.commandLine.getSwitchValue("remote-debugging-port"));
  return port > 0 ? port : undefined;
}

/** The terse human-facing reason studio-drive launched this dev instance. */
function drivePurpose() {
  if (app.isPackaged) {
    return;
  }
  return process.env.STUDIO_DRIVE_PURPOSE || undefined;
}

/**
 * An instance pointed at its own user data directory -- a seeded workspace, say
 * -- is named by that directory. One on the shared dev directory has nothing to
 * add.
 */
function userDataName() {
  const dir = process.env.ELECTRON_USER_DATA_DIR;
  return dir ? path.basename(dir) : undefined;
}

/**
 * The folder holding the checkout, for a linked worktree only: the main
 * checkout is what every other instance is a deviation from, so naming it says
 * nothing an empty slot doesn't. A linked worktree's `.git` is a file pointing
 * back at the main checkout, where the main checkout's is a directory.
 */
function worktreeName() {
  if (app.isPackaged) {
    return;
  }
  // Dev runs Electron against apps/studio, so the checkout is two levels up.
  const root = path.resolve(app.getAppPath(), "..", "..");
  try {
    if (fsSync.statSync(path.join(root, ".git")).isFile()) {
      return path.basename(root);
    }
  } catch {
    // Nothing above this run is a checkout, so there is no worktree to name.
  }
  return;
}

const getAppEnvironment = devOnly
  .output(
    z.object({
      debugPort: z.number().optional(),
      drivePurpose: z.string().optional(),
      isPackaged: z.boolean(),
      userData: z.string().optional(),
      worktree: z.string().optional(),
    }),
  )
  .handler(() => ({
    debugPort: debugPort(),
    drivePurpose: drivePurpose(),
    isPackaged: app.isPackaged,
    userData: userDataName(),
    worktree: worktreeName(),
  }));

const relaunchWithNewUserFolder = devOnly.input(z.void()).handler(() => {
  // app.relaunch() has no env option and the spawned child inherits the
  // parent's environment snapshot, so mutations to process.env here don't
  // carry over. Spawn the new instance directly with the env var set.
  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    env: { ...process.env, ELECTRON_USE_NEW_USER_FOLDER: "true" },
    stdio: "ignore",
  });
  child.unref();
  app.quit();
});

async function openFolder(folderPath: string) {
  const errorMessage = await shell.openPath(folderPath);
  if (errorMessage) {
    shell.showItemInFolder(folderPath);
  }
}

const openUserDataFolder = devOnly.input(z.void()).handler(() => {
  return openFolder(app.getPath("userData"));
});

const openWorkspaceFolder = devOnly.input(z.void()).handler(() => {
  return openFolder(getWorkspaceFolder());
});

const getQuitGuardForced = devOnly
  .output(z.object({ forced: z.boolean() }))
  .handler(() => {
    return { forced: isQuitGuardForcedInDev() };
  });

const setQuitGuardForced = devOnly
  .input(z.object({ forced: z.boolean() }))
  .handler(({ input }) => {
    setQuitGuardForcedInDev(input.forced);
  });

export const debug = {
  browserViewManager: browserViewManagerDebugRoutes,
  events,
  getAppEnvironment,
  getQuitGuardForced,
  openAuthTestPage,
  openOnboarding,
  openUserDataFolder,
  openWorkspaceFolder,
  relaunchWithNewUserFolder,
  setQuitGuardForced,
  systemInfo,
  throwError,
  trigger,
};
