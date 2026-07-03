import { base } from "@/electron-main/rpc/base";
import { sendShellCommand } from "@/electron-main/tabs/tab-command";
import { createMainWindow } from "@/electron-main/windows/main";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { closeOnboardingWindow } from "@/electron-main/windows/onboarding";
import { PRIVATE_BETA_LAUNCH } from "@/shared/constants";

const complete = base.handler(async () => {
  const existingMainWindow = getMainWindow();

  if (!existingMainWindow || existingMainWindow.isDestroyed()) {
    await createMainWindow();
  } else if (existingMainWindow.isVisible()) {
    // Already-visible window means a real re-completion; open a fresh tab.
    sendShellCommand({
      appPath: PRIVATE_BETA_LAUNCH.initialPath,
      newTab: true,
      type: "navigate",
    });
    existingMainWindow.focus();
  } else {
    // Window was prepared hidden during onboarding; just reveal it.
    existingMainWindow.show();
    existingMainWindow.focus();
  }

  closeOnboardingWindow();
});

export const onboarding = {
  complete,
};
