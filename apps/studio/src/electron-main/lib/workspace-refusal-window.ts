import {
  APP_NAME,
  MANUAL_DOWNLOAD_URL,
  typedHostPath,
} from "@instrument-org/shared";
import { app, BrowserWindow, nativeTheme, shell } from "electron";
import os from "node:os";

import { publisher } from "../rpc/publisher";
import { type AppUpdaterHandle } from "./create-app-updater";
import { createStudioAppUpdater } from "./update";
import { type AppUpdaterStatus } from "./update-status";
import { type WorkspaceRefusal } from "./workspace-refusal";

/**
 * The window a folder made by a newer build is said in, before anything
 * else opens: a page of its own with no workspace, no stores and no script
 * behind it, each button a link to an action here, each step drawn as a
 * page anew. It offers to update, which runs the updater with no workspace,
 * or to quit. Closing it quits. A folder that is missing or can't be read
 * is setup's folder step instead (`resolveLaunchWorkspace`).
 */

/** The links the page's buttons are, read here rather than followed. */
const ACTION_SCHEME = "refusal:";

const WIDTH = 480;

type Action = "check-for-updates" | "download" | "quit";

interface View {
  body: string[];
  buttons: { action: Action; label: string; primary?: true }[];
  /** How far a download has come, 0 to 100. */
  progress?: number;
  title: string;
}

export async function showWorkspaceRefusal({
  refusal,
}: {
  refusal: WorkspaceRefusal;
}): Promise<void> {
  // Spelled as Settings spells it, and free to wrap after a separator rather
  // than in the middle of a name, though not right after where it starts
  // (`~/`, `/`, `C:\`), which would leave that alone at the end of a line.
  const where = escapeHtml(
    typedHostPath(refusal.workspace.path, os.homedir()),
  ).replaceAll(/(?<=[^/\\~:])[/\\]/g, "$&<wbr>");
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

  const first: View = {
    body: [`Update ${APP_NAME} to open it. It’s at <code>${where}</code>.`],
    buttons: [
      { action: "quit", label: "Quit" },
      {
        action: "check-for-updates",
        label: "Check for Updates",
        primary: true,
      },
    ],
    title: `Your Instrument folder was made by a newer version of ${APP_NAME}`,
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
      case "check-for-updates": {
        await checkForUpdates();
        return;
      }
      case "download": {
        await shell.openExternal(MANUAL_DOWNLOAD_URL);
        return;
      }
      case "quit": {
        app.exit(0);
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
