import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import { pnpmVersion } from "@/electron-main/lib/pnpm";
import { devOnly } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { getStudioOverlay } from "@/electron-main/studio-overlay";
import { openOnboardingWindow } from "@/electron-main/windows/onboarding";
import { APP_NAME, PORTS } from "@instrument-org/shared";
import {
  StoreId,
  TaskIdSchema,
  workspaceRouter,
} from "@instrument-org/workspace/electron";
import { call } from "@orpc/server";
import { app, shell } from "electron";
import { spawn } from "node:child_process";
import os from "node:os";
import { z } from "zod";

import { browserViewManagerDebugRoutes } from "../../browser-view/debug-snapshot";

function buildSystemFrontMatter() {
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

  return {
    app: `${APP_NAME} v${app.getVersion()} (${env})`,
    locale: app.getLocale(),
    node: process.version,
    os: `${osName} ${os.release()} / ${os.arch()}`,
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
    const frontMatter = buildSystemFrontMatter();
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
};

const openOnboarding = devOnly.input(z.void()).handler(() => {
  openOnboardingWindow();
});

const showOverlayIdle = devOnly.input(z.void()).handler(() => {
  getStudioOverlay()?.showIdle();
});

const showOverlayNotFound = devOnly.input(z.void()).handler(() => {
  getStudioOverlay()?.showNotFound();
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
  showOverlayIdle,
  showOverlayNotFound,
  systemInfo,
  throwError,
  trigger,
};
