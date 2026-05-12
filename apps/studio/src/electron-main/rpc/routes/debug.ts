import { pnpmVersion } from "@/electron-main/lib/pnpm";
import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { openOnboardingWindow } from "@/electron-main/windows/onboarding";
import {
  AppSubdomainSchema,
  StoreId,
  workspaceRouter,
} from "@instrument-org/workspace/electron";
import { call } from "@orpc/server";
import { app } from "electron";
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
    app: `Instrument v${app.getVersion()} (${env})`,
    locale: app.getLocale(),
    node: process.version,
    os: `${osName} ${os.release()} / ${os.arch()}`,
  };
}

const systemInfo = base.handler(async ({ context }) => {
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

const sessionMarkdown = base
  .input(
    z.object({
      sessionId: StoreId.SessionSchema,
      subdomain: AppSubdomainSchema,
    }),
  )
  .output(z.object({ markdown: z.string() }))
  .handler(async ({ context, input, signal }) => {
    const frontMatter = buildSystemFrontMatter();
    return call(
      workspaceRouter.session.toMarkdown,
      { frontMatter, sessionId: input.sessionId, subdomain: input.subdomain },
      { context, signal },
    );
  });

const throwError = base
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
  testNotification: base.handler(async function* ({ signal }) {
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
  testDownloadNotification: base.handler(() => {
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
  testErrorNotification: base.handler(() => {
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
  testNotification: base.handler(() => {
    publisher.publish("test-notification", null);
  }),
};

const openOnboarding = base.input(z.void()).handler(() => {
  openOnboardingWindow();
});

export const debug = {
  browserViewManager: browserViewManagerDebugRoutes,
  live,
  openOnboarding,
  sessionMarkdown,
  systemInfo,
  throwError,
  trigger,
};
