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
import { APP_NAME, PORTS } from "@instrument-org/shared";
import {
  findAvailableName,
  getTaskSettings,
  StoreId,
  taskDir,
  type TaskId,
  TaskIdSchema,
  workspaceRouter,
  type WorkspaceRPCContext,
} from "@instrument-org/workspace/electron";
import { call } from "@orpc/server";
import { app, clipboard, shell } from "electron";
import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

const TranscriptFormatSchema = z.enum(["json", "markdown"]);

const TRANSCRIPT_EXTENSION = {
  json: "json",
  markdown: "md",
} as const satisfies Record<z.output<typeof TranscriptFormatSchema>, string>;

const transcriptInput = z.object({
  format: TranscriptFormatSchema,
  id: TaskIdSchema,
  sessionId: StoreId.SessionSchema,
});

// Both formats are rendered here rather than in the renderer: the JSON one is
// the session record verbatim, and shipping that across the RPC boundary as an
// object only to stringify it again doubles the cost of the largest thing this
// route ever returns.
async function renderTranscript({
  context,
  input,
  signal,
}: {
  context: WorkspaceRPCContext;
  input: z.output<typeof transcriptInput>;
  signal?: AbortSignal;
}) {
  if (input.format === "json") {
    const session = await call(
      workspaceRouter.session.byIdWithMessagesAndParts,
      { id: input.id, sessionId: input.sessionId },
      { context, signal },
    );
    return JSON.stringify(session, null, 2);
  }

  const frontMatter = await buildSystemFrontMatter(input.id);
  const { markdown } = await call(
    workspaceRouter.session.toMarkdown,
    { frontMatter, id: input.id, sessionId: input.sessionId },
    { context, signal },
  );
  return markdown;
}

const sessionTranscript = devOnly
  .input(transcriptInput)
  .output(z.object({ content: z.string() }))
  .handler(async ({ context, input, signal }) => ({
    content: await renderTranscript({ context, input, signal }),
  }));

// Copying happens here rather than in the renderer: a transcript is the largest
// thing this route produces, and the renderer would only be receiving it to hand
// it straight back to the OS.
const copySessionTranscript = devOnly
  .input(transcriptInput)
  .handler(async ({ context, input, signal }) => {
    clipboard.writeText(await renderTranscript({ context, input, signal }));
  });

const saveSessionTranscript = devOnly
  .input(transcriptInput)
  .output(z.object({ filename: z.string(), filepath: z.string() }))
  .handler(async ({ context, input, signal }) => {
    const content = await renderTranscript({ context, input, signal });

    const settings = await getTaskSettings(taskDir(input.id));
    const outputPath = app.getPath("downloads");
    const { name: filename } = await findAvailableName({
      isTaken: (candidate) =>
        fsSync.existsSync(path.join(outputPath, candidate)),
      name: `${transcriptFilenameStem(settings?.name ?? input.id)}.${TRANSCRIPT_EXTENSION[input.format]}`,
      splitExtension: true,
    });

    const filepath = path.join(outputPath, filename);
    await fs.writeFile(filepath, content, "utf8");

    // The transcript is usually saved on its way to an agent, and what an agent
    // needs is the path, not the bytes. Leaving it on the clipboard turns the
    // next step into a paste instead of a hunt through Downloads.
    clipboard.writeText(filepath);

    return { filename, filepath };
  });

// Names the file after the task it came from, the way the zip export does, so a
// Downloads folder holding a few of these still says which is which.
function transcriptFilenameStem(taskName: string) {
  const stem = taskName
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 50);
  return stem ? `${stem}-transcript` : "transcript";
}

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
  copySessionTranscript,
  events,
  getAppEnvironment,
  getQuitGuardForced,
  openAuthTestPage,
  openOnboarding,
  openUserDataFolder,
  openWorkspaceFolder,
  relaunchWithNewUserFolder,
  saveSessionTranscript,
  sessionTranscript,
  setQuitGuardForced,
  systemInfo,
  throwError,
  trigger,
};
