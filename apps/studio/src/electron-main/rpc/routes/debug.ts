import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import { pnpmVersion } from "@/electron-main/lib/pnpm";
import { devOnly } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { openOnboardingWindow } from "@/electron-main/windows/onboarding";
import { APP_NAME, MANUAL_DOWNLOAD_URL, PORTS } from "@instrument-org/shared";
import {
  getTaskSettings,
  StoreId,
  taskDir,
  type TaskId,
  TaskIdSchema,
  workspaceRouter,
} from "@instrument-org/workspace/electron";
import { call } from "@orpc/server";
import { app, shell } from "electron";
import { spawn } from "node:child_process";
import os from "node:os";
import { z } from "zod";

import { browserViewManagerDebugRoutes } from "../../browser-view/debug-snapshot";

async function buildSystemFrontMatter(taskId: TaskId) {
  const platform = os.platform();
  const osName =
    platform === "darwin"
      ? "macOS"
      : platform === "win32"
        ? "Windows"
        : platform === "linux"
          ? "Linux"
          : platform;

  const env = app.isPackaged ? "production" : "development";

  const taskDirPath = taskDir(taskId);
  const settings = await getTaskSettings(taskDirPath);

  return {
    appEnvironment: env,
    appName: APP_NAME,
    currentAppVersion: app.getVersion(),
    runtimeChromeVersion: process.versions.chrome,
    runtimeElectronVersion: process.versions.electron,
    runtimeLocale: app.getLocale(),
    runtimeNodeVersion: process.version,
    runtimeOs: `${osName} ${os.release()} / ${os.arch()}`,
    taskCreatedWithAppVersion: settings?.createdWithAppVersion ?? "unknown",
    taskName: settings?.name ?? "unknown",
    // Absolute path to the task's on-disk folder so an agent reading this
    // transcript can inspect its artifacts (screenshots, output, task.db).
    // Safe to expose unconditionally: this route is dev-only.
    taskDir: taskDirPath,
    transcriptGeneratedAt: new Date().toISOString(),
  };
}

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

const sessionMarkdown = devOnly
  .input(
    z.object({
      id: TaskIdSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.object({ markdown: z.string() }))
  .handler(async ({ context, input, signal }) => {
    const frontMatter = await buildSystemFrontMatter(input.id);
    return call(
      workspaceRouter.session.toMarkdown,
      { frontMatter, id: input.id, sessionId: input.sessionId },
      { context, signal },
    );
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

const live = {
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

// Each reminder trigger fakes a new version so the banner re-shows even after
// its per-version dismiss.
let testReminderVersionCounter = 0;

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
        },
      });
    });
  }),
  testSilentNoUpdate: devOnly.handler(() => {
    publisher.publish("updates.status", {
      status: {
        notifyUser: false,
        type: "not-available",
      },
    });
  }),
  testUpdateReminder: devOnly.handler(({ context }) => {
    testReminderVersionCounter += 1;
    context.appUpdates.debugSetReminder({
      show: true,
      version: `9.9.${testReminderVersionCounter}`,
    });
  }),
  testUpdateRequired: devOnly.handler(({ context }) => {
    const previous = context.appUpdates.requirement;
    context.appUpdates.debugSetRequirement({
      downloadUrl: MANUAL_DOWNLOAD_URL,
      required: true,
    });

    // The block screen covers all chrome including the dev panel, so the
    // preview restores the prior requirement on its own.
    setTimeout(() => {
      context.appUpdates.debugSetRequirement(previous);
    }, 10_000);
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

const getAppEnvironment = devOnly
  .output(z.object({ isPackaged: z.boolean() }))
  .handler(() => ({ isPackaged: app.isPackaged }));

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

export const debug = {
  browserViewManager: browserViewManagerDebugRoutes,
  getAppEnvironment,
  live,
  openAuthTestPage,
  openOnboarding,
  openUserDataFolder,
  openWorkspaceFolder,
  relaunchWithNewUserFolder,
  sessionMarkdown,
  systemInfo,
  throwError,
  trigger,
};
