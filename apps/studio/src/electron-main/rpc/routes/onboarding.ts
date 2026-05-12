import { base } from "@/electron-main/rpc/base";
import { createMainWindow } from "@/electron-main/windows/main";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { closeOnboardingWindow } from "@/electron-main/windows/onboarding";

const complete = base.handler(async () => {
  const existingMainWindow = getMainWindow();
  if (!existingMainWindow || existingMainWindow.isDestroyed()) {
    await createMainWindow();
  } else {
    existingMainWindow.show();
    existingMainWindow.focus();
  }

  closeOnboardingWindow();
});

export const onboarding = {
  complete,
};
