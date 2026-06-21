import {
  base,
} from "@/electron-main/rpc/base";
import {
  getTabsManager,
} from "@/electron-main/tabs";
import {
  createMainWindow,
} from "@/electron-main/windows/main";
import {
  getMainWindow,
} from "@/electron-main/windows/main/instance";
import {
  closeOnboardingWindow,
} from "@/electron-main/windows/onboarding";
import {
  PRIVATE_BETA_LAUNCH,
} from "@/shared/constants";

const complete = base.handler(async () => {
  const existingMainWindow = getMainWindow();

  if (!existingMainWindow || existingMainWindow.isDestroyed()) {
    await createMainWindow(PRIVATE_BETA_LAUNCH);
  } else if (existingMainWindow.isVisible()) {
    // Already-visible window means a real re-completion; open a fresh tab.
    getTabsManager()?.addTab({
      params: PRIVATE_BETA_LAUNCH.initialParams,
      urlPath: PRIVATE_BETA_LAUNCH.initialPath,
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
