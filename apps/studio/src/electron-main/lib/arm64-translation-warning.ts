import {
  app,
  dialog,
} from "electron";

import {
  logger,
} from "./electron-logger";

interface RuntimeEnvironment {
  arch: typeof process.arch;
  isPackaged: boolean;
  platform: typeof process.platform;
  runningUnderARM64Translation: boolean;
}

export function shouldShowARM64TranslationWarning(
  environment: RuntimeEnvironment,
): boolean {
  return (
    environment.isPackaged &&
    (environment.platform === "darwin" || environment.platform === "win32") &&
    environment.arch === "x64" &&
    environment.runningUnderARM64Translation
  );
}

export async function warnIfRunningX64BuildUnderARM64Translation(): Promise<boolean> {
  if (
    !shouldShowARM64TranslationWarning({
      arch: process.arch,
      isPackaged: app.isPackaged,
      platform: process.platform,
      runningUnderARM64Translation: app.runningUnderARM64Translation,
    })
  ) {
    return true;
  }

  try {
    const { response } = await dialog.showMessageBox({
      buttons: ["Quit", "Continue Anyway"],
      cancelId: 0,
      defaultId: 0,
      detail:
        "This version still works, but it was not built for this computer's processor. For the best performance, install the version made for this device.",
      message: `${app.getName()} is running in compatibility mode`,
      noLink: true,
      type: "warning",
    });

    return response === 1;
  } catch (error) {
    logger.warn("Failed to show ARM64 translation launch warning", error);
    return true;
  }
}
