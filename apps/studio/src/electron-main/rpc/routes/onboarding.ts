import { base } from "@/electron-main/rpc/base";
import { getTabsManager } from "@/electron-main/tabs";
import { createMainWindow } from "@/electron-main/windows/main";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { closeOnboardingWindow } from "@/electron-main/windows/onboarding";
import { type StudioPath } from "@/shared/studio-path";

const PRIVATE_BETA_PATH: StudioPath = "/new-tab";

const complete = base.handler(async () => {
  const existingMainWindow = getMainWindow();
  if (!existingMainWindow || existingMainWindow.isDestroyed()) {
    await createMainWindow({
      initialParams: { privateBeta: "true" },
      initialPath: PRIVATE_BETA_PATH,
    });
  } else {
    if (existingMainWindow.isVisible()) {
      getTabsManager()?.addTab({
        params: { privateBeta: "true" },
        urlPath: PRIVATE_BETA_PATH,
      });
    }
    existingMainWindow.show();
    existingMainWindow.focus();
  }

  closeOnboardingWindow();
});

export const onboarding = {
  complete,
};
