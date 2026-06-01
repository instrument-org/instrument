import { base } from "@/electron-main/rpc/base";
import { getTabsManager } from "@/electron-main/tabs";
import { createMainWindow } from "@/electron-main/windows/main";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { closeOnboardingWindow } from "@/electron-main/windows/onboarding";
import { type StudioPath } from "@/shared/studio-path";

const TUTORIAL_TASK_PATH: StudioPath = "/tutorial-task";

const complete = base.handler(async () => {
  const existingMainWindow = getMainWindow();
  if (!existingMainWindow || existingMainWindow.isDestroyed()) {
    await createMainWindow({ initialPath: TUTORIAL_TASK_PATH });
  } else {
    getTabsManager()?.addTab({ urlPath: TUTORIAL_TASK_PATH });
    existingMainWindow.show();
    existingMainWindow.focus();
  }

  closeOnboardingWindow();
});

export const onboarding = {
  complete,
};
