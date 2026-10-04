import { base } from "@/electron-main/rpc/base";
import { openAppWindow } from "@/electron-main/windows/app-window";
import { closeOnboardingWindow } from "@/electron-main/windows/onboarding";

const complete = base.handler(() => {
  // The app window, loaded behind onboarding, takes its place: on screen
  // first, then onboarding closes, which quits the app when it leaves no
  // window behind.
  openAppWindow({ onShow: closeOnboardingWindow });
});

export const onboarding = {
  complete,
};
