import { sendAppCommand } from "@/electron-main/app-command";
import { base } from "@/electron-main/rpc/base";
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
    sendAppCommand({
      newTab: true,
      to: PRIVATE_BETA_LAUNCH.initialPath,
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
