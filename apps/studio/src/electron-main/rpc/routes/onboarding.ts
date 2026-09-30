import { base } from "@/electron-main/rpc/base";
import { openAppWindow } from "@/electron-main/windows/app-window";
import { closeOnboardingWindow } from "@/electron-main/windows/onboarding";

const complete = base.handler(() => {
  // Opened before the onboarding window closes, which quits the app when it
  // leaves no window behind.
  openAppWindow();
  closeOnboardingWindow();
});

export const onboarding = {
  complete,
};
