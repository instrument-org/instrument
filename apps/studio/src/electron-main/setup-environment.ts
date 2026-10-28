import { is, platform } from "@electron-toolkit/utils";
import { APP_NAME } from "@instrument-org/shared";
import { STACK_FRAME_LIMIT } from "@instrument-org/shared/exceptions";
import {
  installAISDKWarningLogger,
  startLoginShellPath,
} from "@instrument-org/workspace/electron";
import { app } from "electron";
import path from "node:path";

import { initializeElectronLogging, logger } from "./lib/electron-logger";
import { getUserDataDir } from "./lib/get-workspace-folder";
import {
  LAUNCH_OVERRIDES_FILENAME,
  readLaunchOverrides,
} from "./lib/launch-overrides";
import {
  decideOzonePlatform,
  OZONE_PLATFORMS,
  resolveOzonePlatform,
} from "./lib/ozone-platform";
import { registerAppStoredPaths } from "./lib/app-stored-paths";
import {
  resolveLaunchWorkspace,
  settleMachineFolders,
} from "./lib/open-workspace";
import { setupDBusEnvironment } from "./lib/setup-dbus-env";
import { settlePlatformApiServer } from "./platform-api/base-url";
import { getMachinePreferences } from "./stores/machine/preferences";
import { setWorkspaceRefusal } from "./lib/workspace-refusal";
import { beginWorkspaceRun } from "./lib/workspace-run";
import { markWorkspaceOpen, releaseOpenMark } from "./lib/workspaces";

// V8 keeps 10 frames by default, which an async call through the workspace
// uses up before reaching the code that started it. As many as an event keeps.
Error.stackTraceLimit = STACK_FRAME_LIMIT;

/**
 * Configures the Electron app's userData directory.
 * This MUST be called before any other Electron APIs that depend on userData.
 * Especially electron-store, which runs in the module scope.
 */
function configureUserDataDirectory() {
  if (process.env.ELECTRON_USER_DATA_DIR) {
    console.log(
      `Using custom user data dir: ${process.env.ELECTRON_USER_DATA_DIR}`,
    );
    app.setPath("userData", process.env.ELECTRON_USER_DATA_DIR);
    return;
  }

  if (is.dev) {
    let suffix = "";
    if (process.env.ELECTRON_DEV_USER_FOLDER_SUFFIX) {
      suffix = ` (${process.env.ELECTRON_DEV_USER_FOLDER_SUFFIX})`;
    }
    const DEV_APP_NAME = `${APP_NAME} (Dev${suffix})`;
    if (suffix) {
      console.log(`Using user folder ${DEV_APP_NAME}`);
    }
    // Must be done as soon as possible because it's stateful
    app.setPath(
      "userData",
      path.join(app.getPath("userData"), "..", DEV_APP_NAME),
    );
    app.setName(DEV_APP_NAME);
  }
}

configureUserDataDirectory();

// An app started from the Dock or a desktop entry has the session's bare PATH,
// and the agent's commands need the person's programs. The PATH saved from
// the last read goes on now; the login shell's is read in the background,
// started first so it has the whole boot to finish, and the agent's shell and
// local app servers wait for it before their first spawn. Does nothing on
// Windows, whose GUI apps get the user's PATH.
startLoginShellPath({
  cacheFile: path.join(app.getPath("userData"), "login-shell-path.json"),
  log: (message) => {
    logger.info(message);
  },
});

// A page can hand an agent its own callable tools, described and typed,
// through `document.modelContext`, instead of making it read the page and
// click. The agent reads that registry over CDP, and the domain it reads
// through needs no switch on this Chromium; this one turns on the page half,
// which a site feature-detects before it registers anything, so without it
// there is nothing on the other side to read. Read before appending, because
// the value already there is the one the browser process took.
const blink = app.commandLine.getSwitchValue("enable-blink-features");
app.commandLine.appendSwitch(
  "enable-blink-features",
  blink ? `${blink},WebMCP` : "WebMCP",
);
// A dev build is a different binary in every checkout, so macOS asks again for
// the keychain's Safe Storage item on each one's first launch. Dev keeps its
// own stores in plaintext, and the mock keychain leaves Chromium's cookie
// encryption with nothing to ask for.
if (is.dev && platform.isMacOS) {
  app.commandLine.appendSwitch("use-mock-keychain");
}

// A development run started with FAKE_MICROPHONE=true records Chromium's test
// tone instead of a microphone, so dictation can be driven without anyone's
// voice and without the system's permission prompt. A path to a WAV file
// records that file instead, looping, so a run can dictate real words.
const fakeMicrophone = process.env.FAKE_MICROPHONE;
if (is.dev && fakeMicrophone) {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
  if (fakeMicrophone !== "true") {
    app.commandLine.appendSwitch(
      "use-file-for-fake-audio-capture",
      fakeMicrophone,
    );
    // The sandboxed audio service cannot open the file and records silence.
    app.commandLine.appendSwitch("disable-features", "AudioServiceSandbox");
  }
}

initializeElectronLogging();
installAISDKWarningLogger();

/**
 * Settles which workspace this process runs, makes a move to a folder the
 * person picked, brings its settings up to this build, and moves what is
 * this computer's own into its machine folder, before any store opens:
 * every workspace store reads its folder from the resolved workspace when it
 * is first asked for. A first launch settles only the machine folder, and
 * setup's first step places the workspace.
 */
function openWorkspace() {
  // First, before a move, a launch migration or a folder found moved by hand
  // writes a stored path where it went: each of those writes every store
  // registered here.
  registerAppStoredPaths();
  // A run that skips setup skips the step where the person chooses the
  // workspace, so it names one itself.
  if (
    process.env.SKIP_ONBOARDING === "true" &&
    !process.env.INSTRUMENT_WORKSPACE
  ) {
    const message =
      "SKIP_ONBOARDING skips setup, where the workspace is chosen, so it needs INSTRUMENT_WORKSPACE naming one: a registered id or an absolute path";
    console.error(message);
    logger.error(message);
    process.exit(1);
  }
  const userDataDir = getUserDataDir();
  const launch = resolveLaunchWorkspace({
    log: logger,
    packaged: app.isPackaged,
    pin: process.env.INSTRUMENT_WORKSPACE,
    userDataDir,
  });
  if (launch.kind === "refused") {
    setWorkspaceRefusal(launch.refusal);
    return;
  }
  // A pinned workspace whose record can't be read is never opened, which
  // would write it again from defaults, and a pinned run has no setup to
  // find it.
  if (
    launch.kind === "unplaced" &&
    launch.lost &&
    process.env.INSTRUMENT_WORKSPACE
  ) {
    const message = `INSTRUMENT_WORKSPACE names ${launch.lost.path}, which can't be opened: ${launch.lost.reason}`;
    console.error(message);
    logger.error(message);
    process.exit(1);
  }
  // After the machine settings migration, which writes the store this reads,
  // and before anything asks the platform API: the server stays the same for
  // the life of the process. A launch for one server names it in
  // `INSTRUMENT_PLATFORM_API` (`studio-drive.mjs boot --account`), over the
  // choice in Settings, which it leaves as it was; only a development build
  // honors it.
  const launchServer = process.env.INSTRUMENT_PLATFORM_API;
  settlePlatformApiServer(
    launchServer
      ? { custom: launchServer }
      : getMachinePreferences().get("platformApiServer"),
  );

  let machineDir: string;
  if (launch.kind === "unplaced") {
    beginWorkspaceRun(launch);
    ({ machineDir } = launch);
  } else {
    const opened = settleMachineFolders({
      log: logger,
      userDataDir,
      workspace: launch.workspace,
    });
    beginWorkspaceRun({ kind: "placed", workspace: opened });
    ({ machineDir } = opened);
  }

  markWorkspaceOpen(machineDir);
  // On process exit rather than `will-quit`: the quit teardown ends in
  // `app.exit`, which skips `will-quit`.
  process.on("exit", () => {
    releaseOpenMark(machineDir);
  });
}

openWorkspace();

// Suppress Unstorage dB0 experimental warning
// Remove when stable https://github.com/unjs/unstorage/blob/main/src/drivers/db0.ts
(
  globalThis as unknown as Record<string, boolean>
).__unstorage_db0_experimental_warning__ = true;

const passwordStore = setupDBusEnvironment();

// Read before any switch is set, because everything it carries has to be
// applied before Chromium starts. It exists for the user who cannot reach the
// environment: the app is launched from a desktop entry, a dock, or a
// compositor keybind, none of which run a shell to export a variable in.
const launchOverrides = readLaunchOverrides(app.getPath("userData"));
for (const problem of launchOverrides.problems) {
  logger.warn(`Ignoring part of ${LAUNCH_OVERRIDES_FILENAME}: ${problem}`);
}

// Logged on every launch, present or not, because the path is the whole point:
// the file is reachable only by someone who knows where it is, and the log is
// what a user sends when they are already stuck. Not gated on Linux either, as
// a driver bad enough to need this exists on every platform.
if (launchOverrides.overrides.disableHardwareAcceleration) {
  app.disableHardwareAcceleration();
  logger.info(`Hardware acceleration disabled by ${launchOverrides.filePath}`);
} else {
  logger.info(
    `Hardware acceleration on; disable it with {"disable-hardware-acceleration": true} in ${launchOverrides.filePath}`,
  );
}

if (platform.isLinux) {
  const ozone = resolveOzonePlatform(process.env.INSTRUMENT_OZONE_PLATFORM);
  if (ozone.ignored) {
    logger.warn(
      `Ignoring INSTRUMENT_OZONE_PLATFORM=${ozone.ignored}; expected one of ${OZONE_PLATFORMS.join(", ")}`,
    );
  }
  // Read before appending, because a value already there is the one the browser
  // process took and the only one its window will honor.
  const decision = decideOzonePlatform(
    ozone.platform,
    app.commandLine.getSwitchValue("ozone-platform") || undefined,
  );
  if (decision.append === null) {
    logger.warn(
      `--ozone-platform=${decision.platform} on the command line decides the display protocol, so neither the session nor INSTRUMENT_OZONE_PLATFORM is consulted. Drop it and set INSTRUMENT_OZONE_PLATFORM instead; a launcher that adds this switch can leave the window blank.`,
    );
  } else {
    app.commandLine.appendSwitch("ozone-platform", decision.append);
  }
  // The switch, not the request, because the two can disagree and an app
  // logging `auto` while talking X11 is a run nobody can diagnose.
  logger.info(
    `Using ozone platform: ${ozone.platform} (switch: ${decision.platform})`,
  );

  // Allow CDP Input.dispatchMouseEvent on occluded web contents (e.g.
  // agent-browser webview guests parked offscreen in the paint host).
  // Without this, Chromium's WidgetInputHandlerManager suppresses input on
  // views that have not yet produced a compositor frame in the visible
  // window, causing click commands to time out on Linux where occlusion
  // tracking is stricter than macOS.
  // https://github.com/electron/electron/issues/35155
  app.commandLine.appendSwitch("allow-pre-commit-input");

  const existing = app.commandLine.getSwitchValue("password-store");
  if (existing) {
    logger.info(
      `Command line already has password-store: ${existing} - not overriding`,
    );
  } else if (passwordStore) {
    app.commandLine.appendSwitch("password-store", passwordStore);
    logger.info(`Using password store: ${passwordStore}`);
  }
}
