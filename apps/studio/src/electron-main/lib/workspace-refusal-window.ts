import {
  APP_NAME,
  MANUAL_DOWNLOAD_URL,
  typedHostPath,
} from "@instrument-org/shared";
import { app, BrowserWindow, dialog, nativeTheme, shell } from "electron";
import os from "node:os";
import path from "node:path";

import { publisher } from "../rpc/publisher";
import { type AppUpdaterHandle } from "./create-app-updater";
import { restartNow } from "./relaunch";
import { createStudioAppUpdater } from "./update";
import { type AppUpdaterStatus } from "./update-status";
import { startWorkspaceAfresh } from "./workspace-management";
import {
  FOLDER_REFUSAL_COPY,
  folderWarningSentence,
} from "../../shared/workspace-folder-refusal";
import { type WorkspaceRefusal } from "./workspace-refusal";
import {
  registerWorkspaceFolder,
  updateRegistry,
  workspaceFolderState,
  workspacePlaceConcern,
} from "./workspaces";

/**
 * The window a refused workspace is said in, before anything else opens: a
 * page of its own with no workspace, no stores and no script behind it,
 * each button a link to an action here, each step drawn as a page anew.
 * For a folder made by a newer build it offers to update, which runs the
 * updater with no workspace; for one it cannot read, or one somewhere no
 * workspace can be, to choose the folder again (the system's own panel,
 * which is also how macOS gives back access to Documents) or to start over
 * with a new one. A chosen folder somewhere the person is only warned of
 * says why, and opens if they go ahead. Closing it quits.
 */

/** The links the page's buttons are, read here rather than followed. */
const ACTION_SCHEME = "refusal:";

const WIDTH = 480;

type Action =
  | "back"
  | "check-for-updates"
  | "choose-folder"
  | "download"
  | "open-anyway"
  | "quit"
  | "start-over"
  | "start-over-confirmed";

interface View {
  body: string[];
  buttons: { action: Action; label: string; primary?: true }[];
  /** How far a download has come, 0 to 100. */
  progress?: number;
  title: string;
}

export async function showWorkspaceRefusal({
  refusal,
  userDataDir,
}: {
  refusal: WorkspaceRefusal;
  userDataDir: string;
}): Promise<void> {
  // Spelled as Settings spells it, and free to wrap after a separator rather
  // than in the middle of a name, though not right after where it starts
  // (`~/`, `/`, `C:\`), which would leave that alone at the end of a line.
  const where = escapeHtml(
    typedHostPath(refusal.workspace.path, os.homedir()),
  ).replaceAll(/(?<=[^/\\~:])[/\\]/g, "$&<wbr>");
  const pinned = refusal.workspace.pinned;
  const window = new BrowserWindow({
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#ffffff",
    fullscreenable: false,
    height: 240,
    maximizable: false,
    resizable: false,
    show: false,
    title: APP_NAME,
    useContentSize: true,
    webPreferences: { partition: "workspace-refusal", sandbox: true },
    width: WIDTH,
  });
  // Off the Mac a window carries Electron's default menu bar, the app's own
  // being built only for a launch that opens a workspace, and its File, Edit
  // and View have nothing to do on this page.
  window.removeMenu();
  // Nothing but this window runs, so closing it is quitting, unless the app
  // is already on its way out to restart or to install an update, whose own
  // exit closes the window.
  let leaving = false;
  window.on("closed", () => {
    if (!leaving) {
      app.exit(0);
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    if (url.startsWith(ACTION_SCHEME)) {
      void act(url.slice(ACTION_SCHEME.length));
    }
  });

  const show = async (view: View) => {
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(page(view))}`,
    );
    // The page's own height: the document's is never less than the window.
    const height: unknown = await window.webContents.executeJavaScript(
      'document.querySelector("main").getBoundingClientRect().height',
    );
    if (typeof height === "number") {
      window.setContentSize(WIDTH, Math.ceil(height));
    }
    if (!window.isVisible()) {
      window.center();
      window.show();
    }
  };

  const folderButtons: View["buttons"] = pinned
    ? [{ action: "quit", label: "Quit", primary: true }]
    : [
        { action: "quit", label: "Quit" },
        { action: "start-over", label: "Start Over" },
        { action: "choose-folder", label: "Choose Folder…", primary: true },
      ];
  const first: View =
    refusal.kind === "newer"
      ? {
          body: [
            `Update ${APP_NAME} to open it. It’s at <code>${where}</code>.`,
          ],
          buttons: [
            { action: "quit", label: "Quit" },
            {
              action: "check-for-updates",
              label: "Check for Updates",
              primary: true,
            },
          ],
          title: `Your Instrument folder was made by a newer version of ${APP_NAME}`,
        }
      : refusal.kind === "misplaced"
        ? {
            body: [
              `It’s at <code>${where}</code>. ${FOLDER_REFUSAL_COPY[refusal.reason].why}, so ${APP_NAME} won’t keep your chats there.`,
              "Choose a different Instrument folder, or start over with a new one.",
            ],
            buttons: folderButtons,
            title: `${APP_NAME} can’t use your Instrument folder where it is`,
          }
        : refusal.why === "denied"
          ? {
              body: [
                `It’s at <code>${where}</code>, and ${APP_NAME} doesn’t have permission to read it.`,
                pinned
                  ? `Give ${APP_NAME} access to it, then open ${APP_NAME} again.`
                  : `Choose the folder again to give ${APP_NAME} access to it, or start over with a new one.`,
              ],
              buttons: folderButtons,
              title: `${APP_NAME} can’t open your Instrument folder`,
            }
          : {
              body: [
                `It was at <code>${where}</code>.`,
                pinned
                  ? `Put it back there, then open ${APP_NAME} again.`
                  : "If you moved it, or it’s on a disk that isn’t connected, choose where it is now. You can also start over with a new one.",
              ],
              buttons: folderButtons,
              title: `${APP_NAME} can’t find your Instrument folder`,
            };

  /**
   * Restarts into what the person chose, or, in a run that can't restart
   * itself, says what it will do once they open it again.
   */
  const reopen = async (onceOpen: string) => {
    leaving = true;
    if (!restartNow()) {
      leaving = false;
      await show({
        body: [`When you open ${APP_NAME} again, it will ${onceOpen}.`],
        buttons: [{ action: "quit", label: "Quit", primary: true }],
        title: `Quit and open ${APP_NAME} again`,
      });
    }
  };

  /** A chosen folder the person was warned of, opened if they go ahead. */
  let warnedOf: string | undefined;

  const chooseFolder = async () => {
    const result = await dialog.showOpenDialog(window, {
      buttonLabel: "Choose",
      defaultPath: refusal.workspace.path,
      message: "Choose your Instrument folder.",
      properties: ["openDirectory", "createDirectory"],
      // What the panel's own title bar says on Linux and Windows, where it
      // would otherwise read "Open File".
      title: "Choose your Instrument folder",
    });
    const [dir] = result.canceled ? [] : result.filePaths;
    if (dir === undefined) {
      return;
    }
    const found = workspaceFolderState(dir);
    if (found === "denied") {
      // Whether the chats are there can't be told, so starting over is not
      // offered as if the folder were empty.
      await show({
        body: [
          `${APP_NAME} doesn’t have permission to read “${escapeHtml(path.basename(dir))}”. Give ${APP_NAME} access to it, then choose it again.`,
        ],
        buttons: [
          { action: "quit", label: "Quit" },
          { action: "choose-folder", label: "Choose Folder…", primary: true },
        ],
        title: `${APP_NAME} can’t read that folder`,
      });
      return;
    }
    const concern =
      found === "workspace"
        ? workspacePlaceConcern({ dir, userDataDir })
        : undefined;
    if (concern?.kind === "refused") {
      await show({
        body: [
          `${FOLDER_REFUSAL_COPY[concern.reason].why}. Choose a different one, or start over with a new one.`,
        ],
        buttons: folderButtons,
        title: `${APP_NAME} can’t use that folder`,
      });
      return;
    }
    if (concern?.kind === "warning") {
      warnedOf = dir;
      await show({
        body: [folderWarningSentence(concern.reason)],
        buttons: [
          { action: "choose-folder", label: "Choose Folder…" },
          { action: "open-anyway", label: "Open Anyway", primary: true },
        ],
        title: "Open your Instrument folder from there?",
      });
      return;
    }
    await openChosen(dir);
  };

  /** Opens the Instrument folder in `dir`, or says there's none there. */
  const openChosen = async (dir: string) => {
    const registered =
      workspaceFolderState(dir) === "workspace"
        ? registerWorkspaceFolder({ dir, userDataDir })
        : undefined;
    if (registered === undefined) {
      await show({
        body: [
          `“${escapeHtml(path.basename(dir))}” doesn’t have your chats in it. Choose the folder that does, or start over with a new one.`,
        ],
        buttons: folderButtons,
        title: "There’s no Instrument folder there",
      });
      return;
    }
    updateRegistry(userDataDir, (registry) => ({
      ...registry,
      active: registered.id,
    }));
    await reopen("open the folder you chose");
  };

  let updater: AppUpdaterHandle | undefined;
  let version: string | undefined;
  const checkForUpdates = async () => {
    if (updater === undefined) {
      updater = createStudioAppUpdater();
      publisher.subscribe("updates.status", ({ status }) => {
        void updateStep(status);
      });
    }
    await show({
      body: ["This takes a moment."],
      buttons: [{ action: "quit", label: "Quit" }],
      title: `Looking for a newer version of ${APP_NAME}`,
    });
    await updater.checkForUpdates({ notify: true });
  };

  const tryAgain: View["buttons"] = [
    { action: "quit", label: "Quit" },
    { action: "check-for-updates", label: "Try Again", primary: true },
  ];
  const updateStep = async (status: AppUpdaterStatus) => {
    switch (status.type) {
      case "available":
      case "downloading": {
        version =
          status.type === "available"
            ? (status.updateInfo?.version ?? version)
            : version;
        await show({
          body: [
            `${APP_NAME} will restart to finish updating once the download is done.`,
          ],
          buttons: [{ action: "quit", label: "Quit" }],
          progress: status.type === "downloading" ? status.progress.percent : 0,
          title: `Downloading ${APP_NAME}${version ? ` ${escapeHtml(version)}` : ""}`,
        });
        return;
      }
      case "canceled":
      case "error": {
        await show({
          body: [
            status.type === "error"
              ? `${escapeHtml(status.message)}. Check your internet connection and try again.`
              : "The download stopped. Check your internet connection and try again.",
          ],
          buttons: tryAgain,
          title: `${APP_NAME} couldn’t check for updates`,
        });
        return;
      }
      case "checking": {
        return;
      }
      case "downloaded": {
        await show({
          body: [`${APP_NAME} will open again in a moment.`],
          buttons: [],
          title: "Restarting to finish updating",
        });
        leaving = true;
        const outcome = await updater?.quitAndInstall();
        if (outcome?.type !== "installing") {
          leaving = false;
        }
        if (outcome?.type === "failed") {
          await show({
            body: [`${escapeHtml(outcome.message)}.`],
            buttons: tryAgain,
            title: `${APP_NAME} couldn’t finish updating`,
          });
        }
        return;
      }
      case "inactive": {
        await show({
          body: [
            `Download the newest version of ${APP_NAME}, then open it to get back to your Instrument folder.`,
          ],
          buttons: [
            { action: "quit", label: "Quit" },
            { action: "download", label: "Download", primary: true },
          ],
          title: `This copy of ${APP_NAME} can’t update itself`,
        });
        return;
      }
      case "installing": {
        await show({
          body: [`${APP_NAME} will open again in a moment.`],
          buttons: [],
          title: "Restarting to finish updating",
        });
        return;
      }
      case "not-available": {
        await show({
          body: [
            `Your Instrument folder needs a version newer than this one. You can try again later, or download the newest version yourself.`,
          ],
          buttons: [
            { action: "quit", label: "Quit" },
            { action: "download", label: "Download" },
            { action: "check-for-updates", label: "Try Again", primary: true },
          ],
          title: `There’s no newer version of ${APP_NAME} yet`,
        });
        return;
      }
    }
  };

  const act = async (action: string) => {
    switch (action) {
      case "back": {
        await show(first);
        return;
      }
      case "check-for-updates": {
        await checkForUpdates();
        return;
      }
      case "choose-folder": {
        await chooseFolder();
        return;
      }
      case "download": {
        await shell.openExternal(MANUAL_DOWNLOAD_URL);
        return;
      }
      case "open-anyway": {
        if (warnedOf !== undefined) {
          await openChosen(warnedOf);
        }
        return;
      }
      case "quit": {
        app.exit(0);
        return;
      }
      case "start-over": {
        await show({
          body: [
            `${APP_NAME} will start with no chats, and you’ll stay signed in. Your old folder is left as it is, so you can open it again later.`,
          ],
          buttons: [
            { action: "back", label: "Back" },
            {
              action: "start-over-confirmed",
              label: "Start Over",
              primary: true,
            },
          ],
          title: "Start over with a new Instrument folder?",
        });
        return;
      }
      case "start-over-confirmed": {
        startWorkspaceAfresh({ id: refusal.workspace.id, userDataDir });
        await reopen("start with a new Instrument folder");
        return;
      }
    }
  };

  await show(first);
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** One step of the window, as a page with no script and nothing loaded from outside. */
function page(view: View) {
  const buttons = view.buttons
    .map(
      (button) =>
        `<a class="button${button.primary ? " primary" : ""}" href="${ACTION_SCHEME}${button.action}">${button.label}</a>`,
    )
    .join("");
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${APP_NAME}</title>
<style>
:root { color-scheme: light dark; --bg: #fff; --fg: #1d1d1f; --muted: #6e6e73; --button: #e9e9ed; --primary: #1d1d1f; --primary-fg: #fff; --track: #e5e5ea; }
@media (prefers-color-scheme: dark) { :root { --bg: #1c1c1e; --fg: #f5f5f7; --muted: #a1a1a6; --button: #3a3a3c; --primary: #f5f5f7; --primary-fg: #1c1c1e; --track: #3a3a3c; } }
html, body { margin: 0; background: var(--bg); color: var(--fg); font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; -webkit-user-select: none; user-select: none; cursor: default; }
main { padding: 26px 26px 20px; display: flex; flex-direction: column; gap: 8px; }
h1 { margin: 0 0 2px; font-size: 15px; font-weight: 600; line-height: 1.35; }
p { margin: 0; color: var(--muted); }
code { font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--fg); overflow-wrap: anywhere; -webkit-user-select: text; user-select: text; }
.progress { height: 4px; border-radius: 2px; background: var(--track); overflow: hidden; margin-top: 6px; }
.progress > div { height: 100%; background: var(--fg); }
footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
footer:empty { display: none; }
a.button { padding: 5px 14px; border-radius: 6px; background: var(--button); color: var(--fg); text-decoration: none; cursor: default; }
a.button.primary { background: var(--primary); color: var(--primary-fg); }
</style></head>
<body><main>
<h1>${view.title}</h1>
${view.body.map((line) => `<p>${line}</p>`).join("\n")}
${view.progress === undefined ? "" : `<div class="progress"><div style="width: ${Math.max(0, Math.min(100, view.progress)).toFixed(1)}%"></div></div>`}
<footer>${buttons}</footer>
</main></body></html>`;
}
