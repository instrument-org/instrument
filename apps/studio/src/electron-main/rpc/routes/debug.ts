import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import { getCallingWindow } from "@/electron-main/windows/calling-window";
import { pnpmVersion } from "@/electron-main/lib/pnpm";
import {
  isQuitGuardForcedInDev,
  setQuitGuardForcedInDev,
} from "@/electron-main/lib/quit";
import { devOnly } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { simulateChromiumSandboxOff } from "@/electron-main/lib/chromium-sandbox";
import {
  noteChatsLeftBehind,
  noteInstallFailed,
  noteStartedOver,
  noteUpdate,
} from "@/electron-main/lib/notices";
import { getNoticesStore } from "@/electron-main/stores/machine/notices";
import { getProblemsStore } from "@/electron-main/stores/machine/problems";
import { simulateSandboxOff } from "@instrument-org/workspace/electron";
import { openPathOnComputer } from "@/electron-main/lib/open-path";
import {
  DEV_INSTANCE_COLORS,
  isDevInstanceColor,
} from "@/shared/dev-instance-colors";
import { worktreeName } from "@/electron-main/lib/worktree-name";
import { app, shell } from "electron";
import path from "node:path";
import { z } from "zod";

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
  // Records an update into the running build, which the bell lists as soon
  // as it's recorded.
  testUpdatedNotice: devOnly.handler(() => {
    noteUpdate({ from: "0.0.0-simulated", to: app.getVersion() });
  }),
  // Puts a notice from the service into the bell, as a stuck build's (which
  // the Update pill shows instead) or as an important one that toasts from
  // the bell, so both show without the service sending them.
  simulateServiceNotice: devOnly
    .input(z.object({ kind: z.enum(["stuck-build", "important"]) }))
    .handler(({ input }) => {
      const store = getNoticesStore();
      const stuck = input.kind === "stuck-build";
      store.set("notices", [
        ...store.get("notices"),
        {
          action: {
            label: "Download",
            url: "https://tryinstrument.com/download",
          },
          body: stuck
            ? `A newer version came out 9 days ago, and this computer is still on ${app.getVersion()}. Downloading it again usually fixes this.`
            : "This is how an important notice from us looks when it arrives.",
          id: `${stuck ? "stuck-build" : "simulated"}-${Date.now()}`,
          kind: stuck ? "update" : "announcement",
          publishedAt: new Date().toISOString(),
          severity: "important",
          title: stuck
            ? "Instrument hasn't been able to update"
            : "A notice from Instrument",
        },
      ]);
    }),
  // Puts every kind of notification in the bell at once, for working on how
  // the bell draws them. The app's own notices are made the way they are in
  // use, so they carry their real words: a crash and a hang from an earlier
  // session, a restart to finish updating, an install that failed, the
  // sandbox off for programs and for web pages, chats left behind, a folder
  // started over. What only the service or a signed-in account can make is a
  // sample: the default model's account signed out, what's new and an
  // announcement. The sandbox stays reported off until the app restarts.
  fillBell: devOnly.handler(() => {
    const now = Date.now();
    const at = (minutesAgo: number) =>
      new Date(now - minutesAgo * 60_000).toISOString();
    getProblemsStore().set("pending", [
      {
        count: 1,
        details: "Simulated crash for the bell.",
        fingerprint: `simulated-crash-${now}`,
        firstAt: now - 3 * 60_000,
        kind: "crash",
        lastAt: now - 3 * 60_000,
        title: "Simulated crash",
      },
      {
        count: 2,
        details: "Simulated hang for the bell.",
        fingerprint: `simulated-hang-${now}`,
        firstAt: now - 26 * 60 * 60_000,
        kind: "hang",
        lastAt: now - 26 * 60 * 60_000,
        title: "Simulated hang",
      },
    ]);
    noteUpdate({
      from: "0.0.0-simulated",
      restarted: true,
      to: app.getVersion(),
    });
    noteInstallFailed({ from: app.getVersion(), to: "99.0.0" });
    noteChatsLeftBehind(3);
    noteStartedOver(getWorkspaceFolder());
    simulateSandboxOff("no-seatbelt");
    simulateChromiumSandboxOff(true);
    getNoticesStore().set("notices", [
      {
        action: {
          label: "Sign in again",
          setting: "claude-account",
          settings: "Providers",
        },
        body: "Sign in again to keep using Claude's models.",
        id: `simulated-account-${now}`,
        kind: "account",
        publishedAt: at(12),
        severity: "critical",
        title: "You're signed out of Claude",
      },
      {
        action: {
          label: "Read more",
          url: "https://tryinstrument.com",
        },
        body: "Projects now keep their own instructions, so every chat you file under one starts with them.",
        id: `simulated-whats-new-${now}`,
        kind: "whats-new",
        publishedAt: at(3 * 24 * 60),
        severity: "info",
        title: "Projects have instructions now",
      },
      {
        body: "We'll be doing maintenance on Saturday morning, so signing in may be slow for an hour.",
        id: `simulated-announcement-${now}`,
        kind: "announcement",
        publishedAt: at(6 * 24 * 60),
        severity: "info",
        title: "Scheduled maintenance this weekend",
      },
    ]);
    publisher.publish("notices.updated", null);
  }),
  // Reports the sandbox as off for a reason, or as it is with none, so the
  // bell's notice and Settings' warning show on a computer whose sandbox
  // works. Nothing about how commands are held changes.
  // Reports web pages as running without Chromium's sandbox, as an AppImage
  // on Ubuntu does, so the bell's notice shows anywhere.
  simulateChromiumSandboxOff: devOnly
    .input(z.object({ off: z.boolean() }))
    .handler(({ input }) => {
      simulateChromiumSandboxOff(input.off);
      publisher.publish("notices.updated", null);
    }),
  simulateSandboxOff: devOnly
    .input(
      z.object({
        off: z
          .enum([
            "did-not-start",
            "no-bubblewrap",
            "no-seatbelt",
            "user-namespaces-closed",
          ])
          .optional(),
      }),
    )
    .handler(({ input }) => {
      simulateSandboxOff(input.off);
      publisher.publish("notices.updated", null);
    }),
};

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

/** The color studio-drive marked this dev instance with, matching its Dock dot. */
function driveColor() {
  const color = process.env.STUDIO_DRIVE_COLOR;
  if (app.isPackaged || !isDevInstanceColor(color)) {
    return;
  }
  return DEV_INSTANCE_COLORS[color];
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

const getAppEnvironment = devOnly
  .output(
    z.object({
      debugPort: z.number().optional(),
      driveColor: z.string().optional(),
      drivePurpose: z.string().optional(),
      isPackaged: z.boolean(),
      userData: z.string().optional(),
      userDataPath: z.string(),
      worktree: z.string().optional(),
    }),
  )
  .handler(() => ({
    debugPort: debugPort(),
    driveColor: driveColor(),
    drivePurpose: drivePurpose(),
    isPackaged: app.isPackaged,
    userData: userDataName(),
    userDataPath: app.getPath("userData"),
    worktree: worktreeName(),
  }));

async function openFolder(folderPath: string) {
  const errorMessage = await openPathOnComputer(folderPath);
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

const toggleDevTools = devOnly.input(z.void()).handler(({ context }) => {
  getCallingWindow(context.webContentsId)?.webContents.toggleDevTools();
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
  getAppEnvironment,
  getQuitGuardForced,
  openUserDataFolder,
  openWorkspaceFolder,
  setQuitGuardForced,
  systemInfo,
  toggleDevTools,
  trigger,
};
